import {
  safeLoad,
  type YamlMap,
  type YAMLMapping,
  type YAMLSequence,
} from "yaml-ast-parser";
import { StructuredSource } from "structured-source";

/**
 * YAML AST wrapper for GitHub Actions workflow files
 * 
 * Provides access to YAML AST nodes and line number tracking
 * for workflow structure elements
 * 
 * @example
 * ```typescript
 * const ast = new WorkflowAst(yamlContent);
 * const jobAsts = ast.jobAsts();
 * console.log(jobAsts[0].startLine()); // line number of first job
 * ```
 */
export class WorkflowAst {
  /** YAML AST root node */
  ast: YamlMap;
  /** Structured source for line number tracking */
  src: StructuredSource;
  
  /**
   * Creates a new WorkflowAst instance
   * @param yaml - YAML content string
   */
  constructor(yaml: string) {
    this.ast = safeLoad(yaml) as YamlMap; // rootは確定でYamlMap型
    this.src = new StructuredSource(yaml);
  }

  /**
   * Gets AST nodes for all jobs in the workflow
   * @returns Array of job AST nodes
   * 
   * @example
   * ```typescript
   * const jobAsts = workflowAst.jobAsts();
   * jobAsts.forEach(job => console.log(job.startLine()));
   * ```
   */
  jobAsts(): JobAst[] {
    const jobsMap = this.ast.mappings.find((it) => it.key.value === "jobs")
      ?.value as YamlMap; // jobsは必ず存在し確定でYamlMap
    return jobsMap.mappings.map((it) => new JobAst(it, this.src));
  }
}

/**
 * YAML AST wrapper for GitHub Actions job definitions
 * 
 * Provides access to job AST nodes and line number tracking
 * for job structure elements
 * 
 * @example
 * ```typescript
 * const jobAst = new JobAst(mappingNode, structuredSource);
 * console.log(jobAst.startLine()); // line number of job
 * const stepAsts = jobAst.stepAsts(); // get step AST nodes
 * ```
 */
export class JobAst {
  /** YAML mapping node for the job */
  ast: YAMLMapping;
  /** Structured source for line number tracking */
  src: StructuredSource;
  
  /**
   * Creates a new JobAst instance
   * @param ast - YAML mapping node for the job
   * @param src - Structured source for line number tracking
   */
  constructor(ast: YAMLMapping, src: StructuredSource) {
    this.ast = ast;
    this.src = src;
  }

  /**
   * Gets AST nodes for all steps in the job
   * @returns Array of step AST nodes, or undefined if job has no steps (e.g., reusable workflow)
   * 
   * @example
   * ```typescript
   * const stepAsts = jobAst.stepAsts();
   * if (stepAsts) {
   *   stepAsts.forEach(step => console.log(step.startLine()));
   * }
   * ```
   */
  stepAsts(): StepAst[] | undefined {
    const jobMap = this.ast.value as YamlMap;
    // If steps exist, they are YAMLSequence; reusable workflows don't have steps
    const stepsSeq = jobMap.mappings.find((it) => it.key.value === "steps")
      ?.value as YAMLSequence | undefined;
    if (stepsSeq === undefined) return undefined;

    return stepsSeq.items.map((it) => new StepAst(it as YAMLMapping, this.src));
  }

  /**
   * Gets the starting line number of the job in the workflow file
   * @returns Line number (1-based)
   * 
   * @example
   * ```typescript
   * const lineNumber = jobAst.startLine();
   * console.log(`Job starts at line ${lineNumber}`);
   * ```
   */
  startLine(): number {
    const pos = this.src.indexToPosition(
      this.ast.startPosition,
    );
    return pos.line;
  }
}

/**
 * YAML AST wrapper for GitHub Actions step definitions
 * 
 * Provides access to step AST nodes and line number tracking
 * 
 * @example
 * ```typescript
 * const stepAst = new StepAst(mappingNode, structuredSource);
 * console.log(stepAst.startLine()); // line number of step
 * ```
 */
export class StepAst {
  /** YAML mapping node for the step */
  ast: YAMLMapping;
  /** Structured source for line number tracking */
  src: StructuredSource;
  
  /**
   * Creates a new StepAst instance
   * @param ast - YAML mapping node for the step
   * @param src - Structured source for line number tracking
   */
  constructor(ast: YAMLMapping, src: StructuredSource) {
    this.ast = ast;
    this.src = src;
  }

  /**
   * Gets the starting line number of the step in the workflow file
   * @returns Line number (1-based)
   * 
   * @example
   * ```typescript
   * const lineNumber = stepAst.startLine();
   * console.log(`Step starts at line ${lineNumber}`);
   * ```
   */
  startLine(): number {
    const pos = this.src.indexToPosition(
      this.ast.startPosition,
    );
    return pos.line;
  }
}
