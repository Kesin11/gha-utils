import { decodeBase64 } from "@std/encoding";
import { chunk } from "@std/collections";
import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";

export type RepositoryResponse =
  RestEndpointMethodTypes["repos"]["get"]["response"]["data"];

export type WorkflowRun =
  RestEndpointMethodTypes["actions"]["getWorkflowRunAttempt"]["response"][
    "data"
  ];
export type WorkflowJobs =
  RestEndpointMethodTypes["actions"]["listJobsForWorkflowRunAttempt"][
    "response"
  ][
    "data"
  ]["jobs"];

export type WorkflowRunUsage =
  RestEndpointMethodTypes["actions"]["getWorkflowRunUsage"]["response"]["data"];

export type ActionsCacheUsage =
  RestEndpointMethodTypes["actions"]["getActionsCacheUsage"]["response"][
    "data"
  ];
export type ActionsCacheList =
  RestEndpointMethodTypes["actions"]["getActionsCacheList"]["response"]["data"];

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

export class FileContent {
  raw: FileContentResponse;
  content: string;
  constructor(getContentResponse: FileContentResponse) {
    this.raw = getContentResponse;
    const textDecoder = new TextDecoder();
    this.content = textDecoder.decode(decodeBase64(getContentResponse.content));
  }
}

type WorkflowUrl = {
  origin: string;
  owner: string;
  repo: string;
  runId: number;
  runAttempt?: number;
};

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

export class Github {
  octokit: Octokit;
  token?: string;
  baseUrl: string;
  isGHES: boolean;
  contentCache: Map<string, FileContent> = new Map();

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

  // NOTE: このリクエスト数はworkflowRunsの数とイコールなので100を余裕で超えてしまう
  // 本来はFetch APIなどhttpクライアント側でリクエスト数制限をかけるべきだが、Denoだと方法が分からない
  // chunk数で並列数を制限してキャッシュを活用することでAPIリクエスト数を抑える
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

  // NOTE: This function might have something wrong. A bug occurred in the actions-timeline.
  // see: https://github.com/Kesin11/actions-timeline/issues/186
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

  // NOTE: このリクエスト数はworkflowRunsの数とイコールなので100を余裕で超えてしまう
  // fetchContent自体を並列に呼び出すとキャッシュにセットする前に次のリクエストが来る可能性があり、実質あまりキャッシュできていない
  // 本来はFetch APIなどhttpクライアント側でリクエスト数制限をかけるべきだが、Denoだと方法が分からない
  // chunk数で並列数を制限してキャッシュを活用することでAPIリクエスト数を抑える
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

  // NOTE: This is a cacheable API if ref is a commit hash; it is also cacheable if ref is a branch, as long as it is short-lived.
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
