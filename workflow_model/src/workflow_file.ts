import { parse } from "@std/yaml";
import { zip } from "@std/collections";
import type { FileContent } from "../../api_client/api_client.ts";
import { type JobAst, type StepAst, WorkflowAst } from "./workflow_ast.ts";

/** GitHub workflow YAML structure */
export type Workflow = {
  name?: string;
  jobs: {
    [key: string]: Job;
  };
  [key: string]: unknown;
};
/**
 * Model representing a GitHub Actions workflow file
 *
 * @example
 * ```typescript
 * const workflow = new WorkflowModel(fileContent);
 * console.log(workflow.name); // workflow name
 * console.log(workflow.jobs); // array of job models
 * ```
 */
export class WorkflowModel {
  /** Original file content from GitHub API */
  fileContent: FileContent;
  /** Parsed YAML workflow object */
  raw: Workflow;
  /** YAML AST for line number tracking */
  ast: WorkflowAst;
  /** GitHub HTML URL for the workflow file */
  htmlUrl?: string;

  /**
   * Creates a new WorkflowModel instance
   * @param fileContent - GitHub API file content response
   */
  constructor(fileContent: FileContent) {
    this.fileContent = fileContent;
    this.ast = new WorkflowAst(fileContent.content);
    this.htmlUrl = fileContent.raw.html_url ?? undefined;
    this.raw = parse(fileContent.content) as Workflow;
  }

  /**
   * Creates a map of workflow names to WorkflowModel instances
   *
   * Note: Assumes WorkflowModel is identical across all runs
   * If duplicate names exist, later values will overwrite earlier ones
   *
   * @param workflowModels - Array of workflow models
   * @returns Map with workflow names as keys and models as values
   *
   * @example
   * ```typescript
   * const models = [workflow1, workflow2];
   * const map = WorkflowModel.createWorkflowNameMap(models);
   * const workflow = map.get("CI");
   * ```
   */
  static createWorkflowNameMap(
    workflowModels: WorkflowModel[],
  ): Map<string, WorkflowModel> {
    return new Map(workflowModels.map((it) => [it.name, it]));
  }

  /**
   * Gets the workflow name
   *
   * If name is not defined in the workflow, returns the file path
   * as per GitHub Actions behavior
   *
   * @see https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#name
   */
  get name(): string {
    return this.raw.name ?? this.fileContent.raw.path;
  }

  /**
   * Gets all jobs in the workflow as JobModel instances
   * @returns Array of job models
   */
  get jobs(): JobModel[] {
    return zip(Object.entries(this.raw.jobs), this.ast.jobAsts()).map(
      ([[id, job], jobAst]) => new JobModel(id, job, this.fileContent, jobAst),
    );
  }
}

/** Reusable workflow YAML structure */
export type ReusableWorkflow = {
  name: string;
  on: {
    workflow_call: unknown;
  };
  jobs: Record<string, Job>;
};
/**
 * Represents a reusable workflow model that can be called from other workflows
 *
 * A reusable workflow is a workflow that can be called from other workflows,
 * enabling code reuse and modular workflow design.
 *
 * @example
 * ```typescript
 * const reusableWorkflow = new ReusableWorkflowModel(fileContent);
 * const jobs = reusableWorkflow.jobs;
 * console.log(`Reusable workflow has ${jobs.length} jobs`);
 * ```
 */
export class ReusableWorkflowModel {
  /** The file content containing the workflow definition */
  fileContent: FileContent;
  /** The parsed raw workflow object */
  raw: ReusableWorkflow;
  /** The AST representation of the workflow (note: it's a fake AST) */
  ast: WorkflowAst; // NOTE: it's fake ast

  /**
   * Creates a new ReusableWorkflowModel instance
   *
   * @param fileContent - The file content containing the workflow definition
   */
  constructor(fileContent: FileContent) {
    this.fileContent = fileContent;
    this.ast = new WorkflowAst(fileContent.content);
    this.raw = parse(fileContent.content) as ReusableWorkflow;
  }

  /**
   * Gets all jobs in the reusable workflow as JobModel instances
   *
   * @returns Array of job models representing all jobs in the workflow
   */
  get jobs(): JobModel[] {
    return zip(Object.entries(this.raw.jobs), this.ast.jobAsts()).map(
      ([[id, job], jobAst]) => new JobModel(id, job, this.fileContent, jobAst),
    );
  }
}

/** GitHub workflow job structure */
export type Job = {
  name?: string;
  "runs-on": string;
  uses?: string;
  steps?: Step[];
  strategy?: {
    matrix?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
/**
 * Represents a job within a GitHub Actions workflow
 *
 * A job is a set of steps that execute on the same runner. Jobs can run in parallel
 * or sequentially depending on dependencies.
 *
 * @example
 * ```typescript
 * const job = new JobModel("build", jobObj, fileContent, jobAst);
 * console.log(`Job ${job.id} has ${job.steps.length} steps`);
 * if (job.isMatrix()) {
 *   console.log("This job uses matrix strategy");
 * }
 * ```
 */
export class JobModel {
  /** The unique identifier for the job */
  id: string;
  /** The display name of the job (optional) */
  name?: string;
  /** The file content containing the job definition */
  fileContent: FileContent;
  /** The raw job object */
  raw: Job;
  /** The AST representation of the job */
  ast: JobAst;
  /** The HTML URL to the workflow file */
  htmlUrl?: string;

  /**
   * Creates a new JobModel instance
   *
   * @param id - The unique identifier for the job
   * @param obj - The raw job object
   * @param fileContent - The file content containing the job definition
   * @param ast - The AST representation of the job
   */
  constructor(
    id: string,
    obj: Job,
    fileContent: FileContent,
    ast: JobAst,
  ) {
    this.id = id;
    this.name = obj.name;
    this.raw = obj;
    this.ast = ast;
    this.fileContent = fileContent;
    this.htmlUrl = fileContent.raw.html_url ?? undefined;
  }

  /**
   * Gets the starting line number of the job in the workflow file
   *
   * @returns The line number where the job starts
   */
  get startLine(): number {
    return this.ast.startLine();
  }

  /**
   * Gets the HTML URL with line number anchor pointing to the job definition
   *
   * @returns The HTML URL with line anchor (e.g., "https://github.com/owner/repo/blob/main/.github/workflows/ci.yml#L15")
   */
  get htmlUrlWithLine(): string {
    return `${this.htmlUrl}#L${this.startLine}`;
  }

  /**
   * Gets all steps in the job as StepModel instances
   *
   * @returns Array of step models, or empty array if no steps are defined
   */
  get steps(): StepModel[] {
    const stepAsts = this.ast.stepAsts();
    if (this.raw.steps === undefined || stepAsts === undefined) return [];

    return zip(this.raw.steps, stepAsts).map(
      ([step, stepAst]) => new StepModel(step, this.fileContent, stepAst),
    );
  }

  /**
   * Finds a job model that matches the given raw name
   *
   * This method handles matching by job ID, job name, and matrix job variations.
   * For matrix jobs, it attempts to match partial names and handles GitHub's
   * matrix job naming conventions.
   *
   * @param jobModels - Array of job models to search through
   * @param rawName - The raw name to match against
   * @returns The matching job model, or undefined if no match found
   *
   * @example
   * ```typescript
   * const matchedJob = JobModel.match(jobs, "build (ubuntu-latest)");
   * if (matchedJob) {
   *   console.log(`Found job: ${matchedJob.id}`);
   * }
   * ```
   */
  static match(
    jobModels: JobModel[] | undefined,
    rawName: string,
  ): JobModel | undefined {
    if (jobModels === undefined) return undefined;

    for (const jobModel of jobModels) {
      if (jobModel.id === rawName) return jobModel;
      if (jobModel.name === rawName) return jobModel;

      if (jobModel.isMatrix()) {
        // case: 'name' is not defined
        if (rawName.startsWith(jobModel.id)) return jobModel;

        if (jobModel.name === undefined) continue;
        // case: 'name' is defined
        // NOTE: If matrix has multiple keys, it maybe can not possible to perfect match.
        const trimedName = jobModel.name.replace(/\$\{\{.+\}\}/g, "").trim();
        if (rawName.includes(trimedName)) return jobModel;
      }
    }

    return undefined;
  }

  /**
   * Checks if this job uses a matrix strategy
   *
   * @returns True if the job has a matrix strategy defined, false otherwise
   *
   * @example
   * ```typescript
   * if (job.isMatrix()) {
   *   console.log("This job will run multiple times with different parameters");
   * }
   * ```
   */
  isMatrix(): boolean {
    if (this.raw.strategy?.matrix !== undefined) return true;
    return false;
  }

  /**
   * Checks if this job is a reusable workflow call
   *
   * @returns True if the job calls a reusable workflow, false otherwise
   *
   * @example
   * ```typescript
   * if (job.isReusable()) {
   *   console.log("This job calls a reusable workflow");
   * }
   * ```
   */
  isReusable(): boolean {
    // Local reusable workflow
    if (this.raw.uses?.startsWith("./")) return true;

    // TODO: Remote reusable workflow

    return false;
  }
}

/** Composite action YAML structure */
export type CompositeAction = {
  name: string;
  description: string | undefined;
  runs: {
    using: "composite";
    steps: Step[];
  };
};
/**
 * Represents a composite action model containing multiple steps
 *
 * A composite action is a custom action that combines multiple workflow steps
 * into a single reusable unit. It allows you to create complex actions that
 * can be shared across workflows.
 *
 * @example
 * ```typescript
 * const compositeAction = new CompositeStepModel(fileContent, fakeAst);
 * const steps = compositeAction.steps;
 * console.log(`Composite action has ${steps.length} steps`);
 * ```
 */
export class CompositeStepModel {
  /** The file content containing the composite action definition */
  fileContent: FileContent;
  /** The parsed raw composite action object */
  raw: CompositeAction;
  /** The AST representation of the step (note: it's a fake AST) */
  ast: StepAst; // NOTE: it's fake ast

  /**
   * Creates a new CompositeStepModel instance
   *
   * @param fileContent - The file content containing the composite action definition
   * @param fakeAst - The fake AST representation for the step
   */
  constructor(fileContent: FileContent, fakeAst: StepAst) {
    this.fileContent = fileContent;
    this.raw = parse(fileContent.content) as CompositeAction;
    this.ast = fakeAst;
  }

  /**
   * Gets all steps in the composite action as StepModel instances
   *
   * @returns Array of step models representing all steps in the composite action
   */
  get steps(): StepModel[] {
    return this.raw.runs.steps.map((step) =>
      new StepModel(step, this.fileContent, this.ast)
    );
  }
}

/** GitHub workflow step structure */
export type Step = {
  uses?: string;
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  [key: string]: unknown;
};
/**
 * Represents a single step within a GitHub Actions job
 *
 * A step is an individual task that can run commands, use actions, or run scripts.
 * Steps are executed in order within a job.
 *
 * @example
 * ```typescript
 * const step = new StepModel(stepObj, fileContent, stepAst);
 * console.log(`Step: ${step.name}`);
 * if (step.uses) {
 *   console.log(`Uses action: ${step.uses.action}@${step.uses.ref}`);
 * }
 * if (step.isComposite()) {
 *   console.log("This step uses a composite action");
 * }
 * ```
 */
export class StepModel {
  /** The raw step object */
  raw: Step;
  /** The display name of the step */
  name: string;
  /**
   * The action reference if the step uses an action
   *
   * For example, "actions/checkout@v4" becomes { action: "actions/checkout", ref: "v4" }
   */
  uses?: { // actions/checkout@v4 => { action: actions/checkout, ref: v4 }
    /** The action name/path */
    action: string;
    /** The version/ref of the action */
    ref?: string;
  };
  /** The AST representation of the step */
  ast: StepAst;
  /** The HTML URL to the workflow file */
  htmlUrl?: string;

  /**
   * Creates a new StepModel instance
   *
   * @param obj - The raw step object
   * @param fileContent - The file content containing the step definition
   * @param ast - The AST representation of the step
   */
  constructor(
    obj: Step,
    fileContent: FileContent,
    ast: StepAst,
  ) {
    this.raw = obj;
    this.uses = obj.uses
      ? { action: obj.uses.split("@")[0], ref: obj.uses.split("@")[1] }
      : undefined;
    this.name = obj.name ?? obj.run ?? this.uses?.action ?? "";
    this.ast = ast;
    this.htmlUrl = fileContent.raw.html_url ?? undefined;
  }

  /**
   * Gets the starting line number of the step in the workflow file
   *
   * @returns The line number where the step starts
   */
  get startLine(): number {
    return this.ast.startLine();
  }

  /**
   * Gets the HTML URL with line number anchor pointing to the step definition
   *
   * @returns The HTML URL with line anchor (e.g., "https://github.com/owner/repo/blob/main/.github/workflows/ci.yml#L25")
   */
  get htmlUrlWithLine(): string {
    return `${this.htmlUrl}#L${this.startLine}`;
  }

  /**
   * Gets a displayable string representation of the step
   *
   * Returns the step name if available, otherwise the action used, run command, or an error message.
   *
   * @returns A string suitable for display purposes
   */
  get showable(): string {
    return this.raw.name ?? this.raw.uses ?? this.raw.run ??
      "Error: Not showable step";
  }

  /**
   * Finds a step model that matches the given raw name
   *
   * This method handles matching by step name, action name, and various GitHub Actions
   * naming conventions including prefixes like "Pre", "Post", "Run", etc.
   *
   * @param stepModels - Array of step models to search through
   * @param rawName - The raw name to match against
   * @returns The matching step model, or undefined if no match found
   *
   * @example
   * ```typescript
   * const matchedStep = StepModel.match(steps, "Run tests");
   * if (matchedStep) {
   *   console.log(`Found step: ${matchedStep.name}`);
   * }
   * ```
   */
  static match(
    stepModels: StepModel[] | undefined,
    rawName: string,
  ): StepModel | undefined {
    if (stepModels === undefined) return undefined;
    if (rawName === "Set up job" || rawName === "Complete job") {
      return undefined;
    }

    // NOTE: stepのAPIの `name` はnameが存在すればnameそのまま, なければ`Run ${uses}`がnameに入っている
    // nameもusesも`Pre `, `Post `のprefixが付くstepが存在する
    // さらにusesの場合はPre Run, Post Runのprefixになる
    const name = rawName.replace(/^(Pre Run |Post Run |Pre |Run |Post )/, "");
    const action = name.split("@")[0];
    for (const stepModel of stepModels) {
      // case: rawName comes from step.name or step.run
      if (stepModel.name === name) return stepModel;
      // case: rawName comes from step.uses
      if (stepModel.uses?.action === action) return stepModel;
    }
    // case: no match
    return undefined;
  }

  /**
   * Checks if this step uses a composite action
   *
   * @returns True if the step uses a composite action, false otherwise
   *
   * @example
   * ```typescript
   * if (step.isComposite()) {
   *   console.log("This step uses a composite action");
   * }
   * ```
   */
  isComposite(): boolean {
    // Call self as action
    if (this.raw.uses === "./") return false;

    // Local composite action
    if (this.raw.uses?.startsWith("./")) return true;

    // TODO: Remote composite action

    return false;
  }
}
