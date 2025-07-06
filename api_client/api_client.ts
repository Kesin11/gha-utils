import { decodeBase64 } from "@std/encoding";
import { chunk } from "@std/collections";
import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";

/** GitHub repository response data */
export type RepositoryResponse =
  RestEndpointMethodTypes["repos"]["get"]["response"]["data"];

/** GitHub workflow run data */
export type WorkflowRun =
  RestEndpointMethodTypes["actions"]["getWorkflowRunAttempt"]["response"][
    "data"
  ];

/** GitHub workflow jobs data */
export type WorkflowJobs =
  RestEndpointMethodTypes["actions"]["listJobsForWorkflowRunAttempt"][
    "response"
  ][
    "data"
  ]["jobs"];

/** GitHub workflow run usage data */
export type WorkflowRunUsage =
  RestEndpointMethodTypes["actions"]["getWorkflowRunUsage"]["response"]["data"];

/** GitHub Actions cache usage data */
export type ActionsCacheUsage =
  RestEndpointMethodTypes["actions"]["getActionsCacheUsage"]["response"][
    "data"
  ];

/** GitHub Actions cache list data */
export type ActionsCacheList =
  RestEndpointMethodTypes["actions"]["getActionsCacheList"]["response"]["data"];

/** GitHub file content response data */
export type FileContentResponse = {
  type: "file";
  size: number;
  name: string;
  path: string;
  content: string;
  sha: string;
  url: string;
  git_url: string | null;
  html_url: string | null;
  download_url: string | null;
};

/**
 * Wrapper class for GitHub file content with decoded text
 * 
 * @example
 * ```typescript
 * const fileContent = new FileContent(response);
 * console.log(fileContent.content); // decoded text content
 * ```
 */
export class FileContent {
  /** Raw file content response from GitHub API */
  raw: FileContentResponse;
  /** Decoded text content */
  content: string;
  
  /**
   * Creates a new FileContent instance
   * @param getContentResponse - GitHub API file content response
   */
  constructor(getContentResponse: FileContentResponse) {
    this.raw = getContentResponse;
    const textDecoder = new TextDecoder();
    this.content = textDecoder.decode(decodeBase64(getContentResponse.content));
  }
}

/** Parsed GitHub workflow run URL components */
type WorkflowUrl = {
  origin: string;
  owner: string;
  repo: string;
  runId: number;
  runAttempt?: number;
};

/**
 * Parses a GitHub workflow run URL to extract components
 * 
 * @param runUrl - GitHub workflow run URL
 * @returns Parsed URL components
 * 
 * @example
 * ```typescript
 * const url = "https://github.com/owner/repo/actions/runs/123456789";
 * const parsed = parseWorkflowRunUrl(url);
 * console.log(parsed.owner); // "owner"
 * console.log(parsed.repo); // "repo"  
 * console.log(parsed.runId); // 123456789
 * ```
 */
export const parseWorkflowRunUrl = (runUrl: string): WorkflowUrl => {
  const url = new URL(runUrl);
  const path = url.pathname.split("/");
  const owner = path[1];
  const repo = path[2];
  const runId = Number(path[5]);
  const runAttempt = path[6] === "attempts" ? Number(path[7]) : undefined;
  return {
    origin: url.origin,
    owner,
    repo,
    runId,
    runAttempt: runAttempt,
  };
};

/**
 * GitHub API client with rate limiting, caching, and retry functionality
 * 
 * @example
 * ```typescript
 * // Initialize with token from environment
 * const github = new Github();
 * 
 * // Or initialize with explicit token
 * const github = new Github({ token: "ghp_xxxx" });
 * 
 * // Fetch workflow runs
 * const runs = await github.fetchWorkflowRuns("owner", "repo");
 * ```
 */
export class Github {
  /** Octokit instance for GitHub API calls */
  octokit: Octokit;
  /** GitHub token for authentication */
  token?: string;
  /** Base URL for GitHub API */
  baseUrl: string;
  /** Whether this is GitHub Enterprise Server */
  isGHES: boolean;
  /** Cache for file content responses */
  contentCache: Map<string, FileContent> = new Map();

  /**
   * Creates a new GitHub API client
   * 
   * @param options - Configuration options
   * @param options.token - GitHub token (defaults to GITHUB_TOKEN env var)
   * @param options.host - GitHub host for GHES (defaults to github.com)
   * @param options.debug - Enable debug logging
   * @param options._workaroundDenoTest - Internal workaround for Deno tests
   */
  constructor(
    options?: {
      token?: string;
      host?: string;
      debug?: boolean;
      _workaroundDenoTest?: boolean;
    },
  ) {
    this.baseUrl = Github.getBaseUrl(options?.host);
    this.isGHES = this.baseUrl !== "https://api.github.com";
    this.token = options?.token ?? Deno.env.get("GITHUB_TOKEN") ?? undefined;
    const MyOctokit = (options?._workaroundDenoTest)
      // Adding throttling causes "Leaks" error when running `deno test`
      // error: Leaks detected:
      // - An interval was started in this test, but never completed. This is often caused by not calling `clearInterval`.
      // It is unclear whether this is a false positive, but since throttling is not used in tests, a workaround is introduced to avoid adding the plugin.
      ? Octokit.plugin(retry)
      : Octokit.plugin(throttling, retry);
    this.octokit = new MyOctokit({
      auth: this.token,
      baseUrl: this.baseUrl,
      log: options?.debug ? console : undefined,
      throttle: {
        onRateLimit: (retryAfter, options, _octokit, retryCount) => {
          this.octokit.log.warn(
            `Request quota exhausted for request ${options.method} ${options.url}`,
          );
          // Retry twice after hitting a rate limit error, then give up
          if (retryCount <= 2) {
            console.warn(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onSecondaryRateLimit: (_retryAfter, options, _octokit, _retryCount) => {
          // does not retry, only logs a warning
          console.warn(
            `Abuse detected for request ${options.method} ${options.url}`,
          );
        },
      },
    });
  }

  /**
   * Gets the base URL for GitHub API
   * @param host - GitHub host for GHES
   * @returns Base URL for GitHub API
   */
  private static getBaseUrl(host?: string): string {
    if (host) {
      return host.startsWith("https://")
        ? `${host}/api/v3`
        : `https://${host}/api/v3`;
    } else if (Deno.env.get("GITHUB_API_URL")) {
      return Deno.env.get("GITHUB_API_URL")!;
    } else {
      return "https://api.github.com";
    }
  }

  /**
   * Fetches repository information
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns Repository data
   * 
   * @example
   * ```typescript
   * const repo = await github.fetchRepository("owner", "repo");
   * console.log(repo.name); // "repo"
   * ```
   */
  async fetchRepository(
    owner: string,
    repo: string,
  ): Promise<RepositoryResponse> {
    const res = await this.octokit.repos.get({
      owner,
      repo,
    });
    return res.data;
  }

  /**
   * Fetches workflow run usage data for multiple workflow runs
   * 
   * Note: This API is not supported on GitHub Enterprise Server
   * Uses chunking to limit concurrent requests and reduce API usage
   * 
   * @param workflowRuns - Array of workflow runs
   * @param chunkSize - Number of concurrent requests (default: 20)
   * @returns Array of workflow run usage data, or undefined for GHES
   * 
   * @example
   * ```typescript
   * const runs = await github.fetchWorkflowRuns("owner", "repo");
   * const usages = await github.fetchWorkflowRunUsages(runs);
   * ```
   */
  async fetchWorkflowRunUsages(
    workflowRuns: WorkflowRun[],
    chunkSize = 20,
  ): Promise<WorkflowRunUsage[] | undefined> {
    // NOTE: GHES does not support this API
    if (this.isGHES) return undefined;

    const workflowRunsChunks = chunk(workflowRuns, chunkSize);
    const workflowRunsUsages: WorkflowRunUsage[] = [];

    for (const chunk of workflowRunsChunks) {
      const promises = chunk.map((run) => {
        return this.octokit.actions.getWorkflowRunUsage({
          owner: run.repository.owner.login,
          repo: run.repository.name,
          run_id: run.id,
        });
      });
      const chunkResults = (await Promise.all(promises)).map((res) => res.data);
      workflowRunsUsages.push(...chunkResults);
    }
    return workflowRunsUsages;
  }

  /**
   * Fetches workflow jobs for multiple workflow runs
   * 
   * Note: This function might have bugs. See: https://github.com/Kesin11/actions-timeline/issues/186
   * Uses chunking to limit concurrent requests
   * 
   * @param workflowRuns - Array of workflow runs
   * @param chunkSize - Number of concurrent requests (default: 20)
   * @returns Array of workflow jobs
   * 
   * @example
   * ```typescript
   * const runs = await github.fetchWorkflowRuns("owner", "repo");
   * const jobs = await github.fetchWorkflowJobs(runs);
   * ```
   */
  async fetchWorkflowJobs(
    workflowRuns: WorkflowRun[],
    chunkSize = 20,
  ): Promise<WorkflowJobs> {
    const workflowJobs: WorkflowJobs = [];
    const workflowJobsChunks = chunk(workflowRuns, chunkSize);

    for (const chunk of workflowJobsChunks) {
      const promises = chunk.map((run) => {
        return this.octokit.actions.listJobsForWorkflowRunAttempt({
          owner: run.repository.owner.login,
          repo: run.repository.name,
          run_id: run.id,
          attempt_number: run.run_attempt ?? 1,
          per_page: 100, // MAX per_page num
        });
      });
      const chunkResults = (await Promise.all(promises)).map((res) =>
        res.data.jobs
      );
      workflowJobs.push(...chunkResults.flat());
    }
    return workflowJobs;
  }

  /**
   * Fetches workflow jobs for a single workflow run
   * 
   * @param workflowRun - Workflow run
   * @returns Array of workflow jobs
   * 
   * @example
   * ```typescript
   * const run = await github.fetchWorkflowRun("owner", "repo", 12345);
   * const jobs = await github.fetchWorkflowRunJobs(run);
   * ```
   */
  async fetchWorkflowRunJobs(
    workflowRun: WorkflowRun,
  ): Promise<WorkflowJobs> {
    const workflowJobs = await this.octokit.actions
      .listJobsForWorkflowRunAttempt({
        owner: workflowRun.repository.owner.login,
        repo: workflowRun.repository.name,
        run_id: workflowRun.id,
        attempt_number: workflowRun.run_attempt ?? 1,
        per_page: 100, // MAX per_page num
      });
    return workflowJobs.data.jobs;
  }

  /**
   * Fetches workflow runs for a repository
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param branch - Optional branch filter
   * @returns Array of workflow runs (excludes dynamic runs like CodeQL)
   * 
   * @example
   * ```typescript
   * const runs = await github.fetchWorkflowRuns("owner", "repo");
   * const mainRuns = await github.fetchWorkflowRuns("owner", "repo", "main");
   * ```
   */
  async fetchWorkflowRuns(
    owner: string,
    repo: string,
    branch?: string,
  ): Promise<WorkflowRun[]> {
    const res = await this.octokit.actions.listWorkflowRunsForRepo(
      {
        owner,
        repo,
        per_page: 100, // MAX per_page num
        branch,
      },
    );
    // Ignore some special workflowRuns that have not workflow file. ex: CodeQL
    return res.data.workflow_runs.filter((run) => run.event !== "dynamic");
  }

  /**
   * Fetches a single workflow run
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param runId - Workflow run ID
   * @param runAttempt - Optional run attempt number
   * @returns Workflow run data
   * 
   * @example
   * ```typescript
   * const run = await github.fetchWorkflowRun("owner", "repo", 12345);
   * const attempt = await github.fetchWorkflowRun("owner", "repo", 12345, 2);
   * ```
   */
  async fetchWorkflowRun(
    owner: string,
    repo: string,
    runId: number,
    runAttempt?: number,
  ): Promise<WorkflowRun> {
    if (runAttempt) {
      const res = await this.octokit.actions.getWorkflowRunAttempt({
        owner,
        repo,
        run_id: runId,
        attempt_number: runAttempt,
      });
      return res.data;
    } else {
      const res = await this.octokit.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });
      return res.data;
    }
  }

  /**
   * Fetches workflow runs with creation date filter
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param created - ISO 8601 date string or range (e.g., "2023-01-01..2023-12-31")
   * @param branch - Optional branch filter
   * @returns Array of workflow runs (excludes dynamic runs like CodeQL)
   * 
   * @example
   * ```typescript
   * const runs = await github.fetchWorkflowRunsWithCreated(
   *   "owner", "repo", "2023-01-01..2023-12-31"
   * );
   * ```
   */
  async fetchWorkflowRunsWithCreated(
    owner: string,
    repo: string,
    created: string,
    branch?: string,
  ): Promise<WorkflowRun[]> {
    const workflowRuns = await this.octokit.paginate(
      this.octokit.actions.listWorkflowRunsForRepo,
      {
        owner,
        repo,
        created,
        per_page: 100, // MAX per_page num
        branch,
      },
    );
    // Ignore some special workflowRuns that have not workflow file. ex: CodeQL
    return workflowRuns.filter((run) => run.event !== "dynamic");
  }

  /**
   * Fetches Actions cache usage for a repository
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns Actions cache usage data
   * 
   * @example
   * ```typescript
   * const usage = await github.fetchActionsCacheUsage("owner", "repo");
   * console.log(usage.full_name); // "owner/repo"
   * ```
   */
  async fetchActionsCacheUsage(
    owner: string,
    repo: string,
  ): Promise<ActionsCacheUsage> {
    const res = await this.octokit.actions.getActionsCacheUsage({
      owner,
      repo,
    });
    return res.data;
  }

  /**
   * Fetches Actions cache list for a repository
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param perPage - Number of items per page (default: 100, max: 100)
   * @returns Actions cache list data
   * 
   * @example
   * ```typescript
   * const caches = await github.fetchActionsCacheList("owner", "repo");
   * console.log(caches.actions_caches.length);
   * ```
   */
  async fetchActionsCacheList(
    owner: string,
    repo: string,
    perPage = 100, // MAX per_page num
  ): Promise<ActionsCacheList> {
    const res = await this.octokit.actions.getActionsCacheList({
      owner,
      repo,
      sort: "size_in_bytes",
      per_page: perPage,
    });
    return res.data;
  }

  /**
   * Fetches workflow files for multiple workflow runs
   * 
   * @param workflowRuns - Array of workflow runs
   * @returns Array of file contents (undefined if file not found)
   * 
   * @example
   * ```typescript
   * const runs = await github.fetchWorkflowRuns("owner", "repo");
   * const files = await github.fetchWorkflowFiles(runs);
   * ```
   */
  async fetchWorkflowFiles(
    workflowRuns: WorkflowRun[],
  ): Promise<(FileContent | undefined)[]> {
    const promises = workflowRuns.map((workflowRun) => {
      return this.fetchContent({
        owner: workflowRun.repository.owner.login,
        repo: workflowRun.repository.name,
        path: workflowRun.path,
        ref: workflowRun.head_sha,
      });
    });
    return await Promise.all(promises);
  }

  /**
   * Fetches workflow files for multiple workflow runs at a specific ref
   * 
   * Uses chunking to limit concurrent requests and leverage caching
   * to reduce API usage
   * 
   * @param workflowRuns - Array of workflow runs
   * @param ref - Git reference (commit hash, branch, or tag)
   * @param chunkSize - Number of concurrent requests (default: 20)
   * @returns Array of file contents (undefined if file not found)
   * 
   * @example
   * ```typescript
   * const runs = await github.fetchWorkflowRuns("owner", "repo");
   * const files = await github.fetchWorkflowFilesByRef(runs, "main");
   * ```
   */
  async fetchWorkflowFilesByRef(
    workflowRuns: WorkflowRun[],
    ref: string,
    chunkSize = 20,
  ): Promise<(FileContent | undefined)[]> {
    const workflowRunsChunks = chunk(workflowRuns, chunkSize);

    const results = [];
    for (const chunk of workflowRunsChunks) {
      const chunkResults = await Promise.all(chunk.map((workflowRun) => {
        return this.fetchContent({
          owner: workflowRun.repository.owner.login,
          repo: workflowRun.repository.name,
          path: workflowRun.path,
          ref,
        });
      }));
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Fetches file content from GitHub repository
   * 
   * This method is cacheable - responses are cached if ref is a commit hash
   * or for short-lived branch references
   * 
   * @param params - Parameters for fetching content
   * @param params.owner - Repository owner
   * @param params.repo - Repository name
   * @param params.path - File path
   * @param params.ref - Git reference (commit hash, branch, or tag)
   * @returns File content or undefined if not found
   * 
   * @example
   * ```typescript
   * const content = await github.fetchContent({
   *   owner: "owner",
   *   repo: "repo",
   *   path: ".github/workflows/ci.yml",
   *   ref: "main"
   * });
   * if (content) {
   *   console.log(content.content); // YAML content
   * }
   * ```
   */
  // deno-lint-ignore require-await
  async fetchContent(params: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<(FileContent | undefined)> {
    const cache = this.contentCache.get(JSON.stringify(params));
    if (cache) return cache;

    return this.octokit.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    })
      .then((res) => {
        if (!Array.isArray(res.data) && res.data.type === "file") {
          const fetchedFileContent = new FileContent(res.data);

          this.contentCache.set(JSON.stringify(params), fetchedFileContent);
          return fetchedFileContent;
        }
      })
      .catch((_error) => {
        console.warn(
          `fetchContent not found: ref: ${params.ref}, path: ${params.owner}/${params.repo}/${params.path}`,
        );
        return undefined;
      });
  }
}
