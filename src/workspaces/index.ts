export {
  ChildProcessGitCommandRunner,
  GitCommandError,
  type ChildProcessGitCommandRunnerOptions,
  type GitCommandInput,
  type GitCommandResult,
  type GitCommandRunner
} from "./git-command-runner.js";
export {
  GitWorktreeManager,
  type GitWorktreeManagerOptions
} from "./git-worktree-manager.js";
export {
  defaultRepositoryMutationLock,
  InProcessRepositoryMutationLock,
  type RepositoryMutationLock
} from "./repository-mutation-lock.js";
export {
  WorkspaceManagerError,
  type WorkspaceManagerErrorCode
} from "./errors.js";
export type {
  WorkspaceCleanupOptions,
  WorkspaceFinalizeAction,
  WorkspaceFinalizeError,
  WorkspaceFinalizeOptions,
  WorkspaceFinalizeReason,
  WorkspaceFinalizeResult,
  WorkspaceLease,
  WorkspaceListOptions,
  WorkspaceManager,
  WorkspacePrepareInput,
  WorkspaceRetention
} from "./types.js";
