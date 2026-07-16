import { lstat, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import { WorkspaceManagerError } from "./errors.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const LEASES_DIRECTORY = ".leases";

export function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

export function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "EEXIST";
}

export function isSameOrDescendant(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ""
    || (!isAbsolute(pathFromParent)
      && pathFromParent !== ".."
      && !pathFromParent.startsWith(`..${sep}`));
}

export function assertSafeSegment(value: string, kind: "key" | "namespace"): void {
  const code = kind === "key"
    ? "INVALID_WORKSPACE_KEY"
    : "INVALID_WORKSPACE_NAMESPACE";

  if (
    !SAFE_SEGMENT.test(value)
    || value.endsWith(".")
    || WINDOWS_RESERVED_NAME.test(value)
  ) {
    throw new WorkspaceManagerError(
      code,
      `Workspace ${kind} must be a safe, non-reserved path segment`
    );
  }
}

export function assertValidRef(ref: string): void {
  if (
    ref.length === 0
    || ref.length > 1024
    || ref.trim() !== ref
    || /[\0\r\n]/.test(ref)
  ) {
    throw new WorkspaceManagerError("INVALID_REF", "Git ref is invalid");
  }
}

export function isCommitId(value: string): boolean {
  return COMMIT_ID.test(value);
}

export async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function canonicalizeProspectivePath(path: string): Promise<string> {
  let cursor = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const existingPath = await realpath(cursor);
      return resolve(existingPath, ...missingSegments);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      const parent = dirname(cursor);
      if (parent === cursor) {
        throw error;
      }
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}
