export type WorkspaceManagerErrorCode =
  | "INVALID_REPOSITORY"
  | "WORKSPACE_REPOSITORY_NOT_ALLOWED"
  | "INVALID_REF"
  | "INVALID_WORKSPACE_KEY"
  | "INVALID_WORKSPACE_NAMESPACE"
  | "WORKSPACE_ROOT_CONFLICT"
  | "WORKSPACE_PATH_ESCAPE"
  | "WORKSPACE_CONFLICT"
  | "WORKSPACE_PREPARE_FAILED"
  | "WORKSPACE_ABORTED"
  | "INVALID_WORKSPACE_LEASE"
  | "WORKSPACE_LIST_FAILED";

export class WorkspaceManagerError extends Error {
  readonly code: WorkspaceManagerErrorCode;

  constructor(
    code: WorkspaceManagerErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkspaceManagerError";
    this.code = code;
  }
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError"
    || ("code" in error && error.code === "ABORT_ERR")
    || (error instanceof WorkspaceManagerError && error.code === "WORKSPACE_ABORTED");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkspaceManagerError(
      "WORKSPACE_ABORTED",
      "Workspace operation was aborted"
    );
  }
}
