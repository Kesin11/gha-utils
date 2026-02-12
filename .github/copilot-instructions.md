# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Deno utility library providing GitHub Actions API client and workflow models. Published on JSR (@kesin11/gha-utils) and used by multiple GitHub Actions-related projects.

## Development Commands

```bash
# Run all tests
deno test

# Run a single test file
deno test api_client/api_client.test.ts

# Run tests matching a filter (describe/it name)
deno test --filter "WorkflowModel"

# Format code
deno fmt

# Lint code
deno lint

# Type check
deno check **/*.ts

# Lint documentation (checks JSDoc exports)
deno task doc:lint
```

### CI Checks

CI runs: `deno fmt --check`, `deno lint`, `deno test -A`, `deno task doc:lint`

## Code Architecture

### Layered Structure

The library has two independent modules with a clear layered design:

**api_client/** — GitHub Actions API client

- `Github` class wraps Octokit with rate limiting, retry, and content caching
- Fetches workflow runs, jobs, usage data, cache info, and workflow YAML files
- Supports GitHub Enterprise Server (GHES) via host option
- Requires `GITHUB_TOKEN` via environment variable or constructor option

**workflow_model/** — Workflow file parsing and models

- Two parallel parsing strategies for the same YAML:
  - `WorkflowModel` / `JobModel` / `StepModel` (in `src/workflow_file.ts`): Parse YAML via @std/yaml into structured data models for querying job/step properties, matrix config, reusable workflow detection, and name matching
  - `WorkflowAst` / `JobAst` / `StepAst` (in `src/workflow_ast.ts`): Parse YAML via yaml-ast-parser + structured-source for **source line number tracking** — used to map jobs/steps back to their line positions in the original YAML

### Export Structure

Published on JSR with modular imports — users can import from the root (`@kesin11/gha-utils`) or specific subpaths (`@kesin11/gha-utils/api_client`, `@kesin11/gha-utils/workflow_file`, `@kesin11/gha-utils/workflow_ast`).

### Testing

BDD style (describe/it) using @std/testing. Tests use inline dummy YAML objects and fixture files in `workflow_model/tests/fixtures/`.
