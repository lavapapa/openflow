# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- **Managed Git worktree workspaces**: `agent()` can request a detached, per-run Git worktree with explicit repository, ref, key, and retention policy. The runtime isolates concurrent file-producing agents, records workspace lifecycle artifacts and events, retains failed or dirty worktrees, and exposes safe cleanup, explicit discard, and list APIs.
- **CLI and SDK worktree roots**: CLI runs accept `--worktrees-dir`; SDK clients accept `workspace.worktreesDir`.
- **Repository authorization**: Default CLI and SDK composition roots restrict managed worktrees to the runtime repository; custom hosts may provide an explicit `allowedRepositories` set.

### Changed

- Git dependencies now build distributable `dist` files through the standard `prepare` lifecycle, so hosts can pin an unreleased commit and load the public package exports.
- Managed-worktree agent calls are audit-recorded but excluded from resume cache lookup and cache-index rebuilds, because replaying an agent result cannot reproduce its filesystem changes.
- Explicit discard can reclaim a durable `preparing` lease and partial directory left by a failed or cancelled `git worktree add`.
- The former `workspace.mode: "isolated"` placeholder is rejected because it never created an isolated directory; callers must use `"git-worktree"` for working-file isolation.

## [0.4.0] - 2026-06-25

### Added

- **Agent Thinking Effort (`thinkingEffort`)**: Added support for configuring reasoning/thinking effort levels on agent calls. Users can set the `thinkingEffort` parameter directly in `agent()` DSL calls or set a default via the `defaultThinkingEffort` configuration. Supports mappings and validations for `codex` (via `-c model_reasoning_effort`), `pi` (via `--thinking`), and `opencode` (via `--variant`) providers, adhering to resolution precedence rules.
- **Tool DSL Execution in Loops**: Added support for executing deterministic tools inside loop round callbacks via the loop round context. The loop round context now exposes `ctx.tool(input)` and `ctx.toolId(suffix)` which bypass the global tool restriction inside loop rounds. Uses deterministic tool ID generation to ensure proper integration with execution resume and cache replay.
- **Max Agent Calls Limit**: Added a run limit safety guardrail to prevent infinite agent call loops. The limit is configurable via `--max-agent-calls` CLI option (on `run`/`resume`) and `maxAgentCalls` project configuration. Exceeding the limit halts execution with a `RUN_LIMIT_EXCEEDED` code.
- **Project Configuration Hints**: Added CLI initialization hints (`PROJECT_INIT_MISSING`) when `.open-dynamic-workflow/config.yaml` is missing, showing commands to bootstrap directories and configuration depending on the resolved CLI executable name (`odw` or `open-dynamic-workflow`).
- **Durable Ultra-Loop Example**: Added a comprehensive workflow example (`ultra-loop`) showcasing evidence-gated loop execution, checkpoint saving, steering, and quality reviews in a self-contained directory.

### Changed & Improved

- **GitHub Actions CI Workflow**: Added CI configuration `.github/workflows/ci.yml` running linting, typechecking, building, and unit tests on Node versions 20.x and 22.x.
- **Test Infrastructure Stability**: Fixed filesystem mocks for `readdir` and `stat` in CLI test suites and increased vitest package execution test timeouts to 60s to ensure reliable CI runs.
- **Git Config**: Updated gitignore configuration to ignore the `plans` directory instead of `docs`.

## [0.3.5] - 2026-06-21


### Added

- **Loop DSL Primitive**: Introduced the stateful `loop(input)` primitive to the Workflow DSL for goal-oriented, repeated callback execution. Features robust round-by-round state transitions, failure mode options ("throw" or "settled"), deterministic sub-agent ID mapping, execution timeouts, persistent round artifact tracking, and rich visual status updates in pretty/JSON/JSONL reporters.

- **Cursor Agent Integration**: Added the `cursor` provider adapter to support orchestrating tasks through the Cursor Agent CLI, featuring trust flags, custom modes and models, workspace targets, and graceful plain-text parsing fallback.

- **Linting & Code Health**: Integrated ESLint 10.x with flat configuration (`eslint.config.js`) and resolved all lint warnings, unused variables, types, and imports across the entire codebase.

- **Log Event Data Previews**: Extended the workflow log output to format and display optional event data payloads (such as quality gate results) with structured indentation.

### Fixed
- **Pretty Reporter Output**: Fixed formatting to ensure quality gate logs and other workflow logs with attached context display their event data payloads correctly in the pretty reporter.


## [0.3.0] - 2026-06-16

### Added
- **Shared Agents**: Introduce support for defining, validating, loading, and executing reusable shared agent definitions across workflows.
- **Child Workflows (Nested Workflows)**: Support invoking child workflows within a parent workflow context with structured output collection, error propagation, and nested cancellation.
- **Project Scaffolding (`init` command)**: Added the `init` command to easily bootstrap a new project config (`config.yaml`), agent directories, tool directories, and starter workflows.
- **Name-Based Execution**: Allow validating and running workflows by their declared name (`meta.name`) in addition to direct file paths.
- **Resource Discovery (`list` command)**: Added a command to discover and list all registered workflows, agents, and tools in the current project.
- **New Provider Adapters**: Integrated support for GitHub Copilot CLI, antigravity-cli, opencode-cli, and pi-coding-agent.
- **Resumable Cache**: Implemented resumable cache support for tools, including result replay and strict path traversal safety validations.

### Refactored & Improved
- **Project Renaming**: Renamed the package, CLI binary, skills directory, configurations, and documentation from `openflow` (or `@prmflow/openflow`) to `@travisliu/open-dynamic-workflow` (CLI executable `open-dynamic-workflow` / alias `odw`).
- **Event-Driven Pretty Reporter**: Refactored the pretty reporter into a modular, event-driven architecture, separating tree aggregation, status rendering, and format styling.
- **Cache Normalization**: Cleaned up materialized results to remove undefined properties from cache files.
- **Test Infrastructure**: Increased Vitest package execution and global installation test timeouts to 30s to ensure consistent CI runs.
