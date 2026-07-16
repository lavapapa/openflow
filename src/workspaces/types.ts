export interface WorkspacePrepareInput {
  repository: string;
  ref: string;
  key: string;
  namespace: string;
  signal?: AbortSignal;
}

export interface WorkspaceLease {
  path: string;
  repository: string;
  commit: string;
  key: string;
  namespace: string;
}

export type WorkspaceRetention = "on-failure" | "always";

export interface WorkspaceFinalizeOptions {
  succeeded: boolean;
  retention: WorkspaceRetention;
  signal?: AbortSignal;
}

export interface WorkspaceCleanupOptions {
  signal?: AbortSignal;
}

export interface WorkspaceListOptions {
  repository?: string;
  namespace?: string;
  signal?: AbortSignal;
}

export type WorkspaceFinalizeAction = "removed" | "retained" | "absent";

export type WorkspaceFinalizeReason =
  | "retention-policy"
  | "run-failed"
  | "dirty"
  | "head-changed"
  | "cleanup-failed"
  | "missing";

export interface WorkspaceFinalizeError {
  name: string;
  message: string;
}

export interface WorkspaceFinalizeResult {
  action: WorkspaceFinalizeAction;
  lease: WorkspaceLease;
  reason?: WorkspaceFinalizeReason;
  error?: WorkspaceFinalizeError;
}

/**
 * Host-facing boundary. Runtime and domain objects should depend on this
 * interface instead of constructing Git/process dependencies themselves.
 */
export interface WorkspaceManager {
  prepare(input: WorkspacePrepareInput): Promise<WorkspaceLease>;
  finalize(
    lease: WorkspaceLease,
    options: WorkspaceFinalizeOptions
  ): Promise<WorkspaceFinalizeResult>;
  cleanup(
    lease: WorkspaceLease,
    options?: WorkspaceCleanupOptions
  ): Promise<WorkspaceFinalizeResult>;
  /**
   * Explicitly discard uncommitted changes after a host has accepted or
   * rejected the candidate. A changed HEAD is still retained.
   */
  discard(
    lease: WorkspaceLease,
    options?: WorkspaceCleanupOptions
  ): Promise<WorkspaceFinalizeResult>;
  list(options?: WorkspaceListOptions): Promise<readonly WorkspaceLease[]>;
}
