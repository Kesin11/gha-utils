# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Deno utility library providing GitHub Actions API client and workflow models. Published on JSR (@kesin11/gha-utils) and used by multiple GitHub Actions-related projects.

## Development Commands

### Core Development Commands

```bash
# Run tests
deno test

# Format code
deno fmt

# Lint code
deno lint

# Type check
deno check **/*.ts
```

### Documentation Commands

```bash
# Generate documentation
deno task doc

# Lint documentation
deno task doc:lint
```

## Code Architecture

### Main Components

- **api_client**: GitHub Actions API client
  - `Github` class: API rate limiting, caching, retry functionality
  - Fetch workflow runs, jobs, and usage data
  - GitHub Enterprise Server support

- **workflow_model**: GitHub Actions workflow models
  - `WorkflowModel`: Structured representation of workflow files
  - `JobModel`: Structured representation of jobs
  - `StepModel`: Structured representation of steps
  - `WorkflowAst`: YAML AST parsing and source code line number management

### Dependencies

- **GitHub API**: @octokit/rest, @octokit/plugin-throttling, @octokit/plugin-retry
- **YAML Processing**: @std/yaml, yaml-ast-parser
- **Deno Standard Library**: @std/assert, @std/collections, @std/encoding, @std/path, @std/testing

### Testing Approach

- Uses Deno standard testing library (@std/testing)
- BDD style (describe/it)
- Test files:
  - `api_client/api_client.test.ts`
  - `workflow_model/tests/workflow_file.test.ts`
  - `workflow_model/tests/workflow_ast.test.ts`

### Environment Requirements

- **GITHUB_TOKEN**: Required via environment variable or constructor
- **API Limits**: Chunk processing to limit request count
- **Caching**: Content fetch caching functionality

### Export Structure

- Modular structure (api_client, workflow_ast, workflow_file)
- `mod.ts` serves as entry point
- Published on JSR
