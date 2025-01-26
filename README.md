# gha-utils [![JSR](https://jsr.io/badges/@kesin11/gha-utils)](https://jsr.io/@<scope>/<package>)

Deno Util libraries for GitHub Actions.

This used by my GitHub Actions related projects.

- [Kesin11/actions-timeline](https://github.com/Kesin11/actions-timeline)
- [Kesin11/gh-workflow-ls](https://github.com/Kesin11/gh-workflow-ls)
- [Kesin11/gh-actions-scanner](https://github.com/Kesin11/gh-actions-scanner)

## api_client

API client for GitHub Actions related APIs. It covers common use case of fetch Workflow Run, Job and usage. Also supports fetching workflows yaml file.

## workflow_model

It provides models for GitHub Actions workflows, breaking them down into structured representations of workflows, jobs, and steps. It includes classes like `WorkflowModel`, `ReusableWorkflowModel`, `JobModel`, `CompositeStepModel`, and `StepModel`.

These classes parse and structure the raw YAML content of workflow files, making it easier to interact with and manipulate the workflow components programmatically.
