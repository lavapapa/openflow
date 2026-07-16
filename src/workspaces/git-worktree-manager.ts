import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  resolve
} from "node:path";
import {
  ChildProcessGitCommandRunner,
  GitCommandError,
  type GitCommandRunner
} from "./git-command-runner.js";
import {
  defaultRepositoryMutationLock,
  type RepositoryMutationLock
} from "./repository-mutation-lock.js";
import {
  isAbortError,
  throwIfAborted,
  WorkspaceManagerError
} from "./errors.js";
import {
  assertSafeSegment,
  assertValidRef,
  canonicalizeProspectivePath,
  isAlreadyExistsError,
  isCommitId,
  isSameOrDescendant,
  LEASES_DIRECTORY,
  lstatIfPresent
} from "./path-safety.js";
import type {
  WorkspaceCleanupOptions,
  WorkspaceFinalizeError,
  WorkspaceFinalizeOptions,
  WorkspaceFinalizeResult,
  WorkspaceLease,
  WorkspaceListOptions,
  WorkspaceManager,
  WorkspacePrepareInput
} from "./types.js";

const LEASE_RECORD_VERSION = 1;

interface RepositoryInfo {
  repository: string;
  commonDir: string;
}

interface LeaseRecord {
  version: typeof LEASE_RECORD_VERSION;
  state: "preparing" | "ready";
  lease: WorkspaceLease;
}

export interface GitWorktreeManagerOptions {
  rootDir: string;
  /**
   * Optional host authorization boundary. Each entry may be the repository
   * root or any path inside it. Omit only when the caller intentionally allows
   * this manager to operate on arbitrary repositories.
   */
  allowedRepositories?: readonly string[];
  commandRunner?: GitCommandRunner;
  mutationLock?: RepositoryMutationLock;
}

function serializeError(error: unknown): WorkspaceFinalizeError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

export class GitWorktreeManager implements WorkspaceManager {
  private readonly configuredRoot: string;
  private readonly commandRunner: GitCommandRunner;
  private readonly mutationLock: RepositoryMutationLock;
  private readonly allowedRepositoryPaths: readonly string[] | undefined;
  private rootPromise?: Promise<string>;
  private allowedRepositoriesPromise?: Promise<ReadonlySet<string>>;

  constructor(options: GitWorktreeManagerOptions) {
    if (options.rootDir.trim().length === 0) {
      throw new WorkspaceManagerError(
        "WORKSPACE_PATH_ESCAPE",
        "Workspace root directory is required"
      );
    }

    this.configuredRoot = resolve(options.rootDir);
    this.commandRunner = options.commandRunner ?? new ChildProcessGitCommandRunner();
    this.mutationLock = options.mutationLock ?? defaultRepositoryMutationLock;
    this.allowedRepositoryPaths = options.allowedRepositories?.map((entry) => resolve(entry));
  }

  async prepare(input: WorkspacePrepareInput): Promise<WorkspaceLease> {
    assertSafeSegment(input.key, "key");
    assertSafeSegment(input.namespace, "namespace");
    assertValidRef(input.ref);
    throwIfAborted(input.signal);

    const repository = await this.resolveRepository(input.repository, input.signal);
    const commit = await this.resolveCommit(repository, input.ref, input.signal);
    const prospectiveRoot = await canonicalizeProspectivePath(this.configuredRoot);
    this.assertRootOutsideRepository(prospectiveRoot, repository.repository);

    throwIfAborted(input.signal);
    const root = await this.ensureRoot();
    this.assertRootOutsideRepository(root, repository.repository);
    const workspaceNamespaceDir = await this.ensureSafeDirectory(
      root,
      input.namespace,
      root
    );
    const leasesDir = await this.ensureSafeDirectory(root, LEASES_DIRECTORY, root);
    const leaseNamespaceDir = await this.ensureSafeDirectory(
      leasesDir,
      input.namespace,
      root
    );

    const workspacePath = join(workspaceNamespaceDir, input.key);
    const recordPath = join(leaseNamespaceDir, `${input.key}.json`);
    const lease: WorkspaceLease = {
      path: workspacePath,
      repository: repository.repository,
      commit,
      key: input.key,
      namespace: input.namespace
    };

    try {
      return await this.mutationLock.runExclusive(
        repository.commonDir,
        async () => {
          throwIfAborted(input.signal);
          await this.assertAvailable(workspacePath, recordPath);
          await this.createLeaseRecord(recordPath, {
            version: LEASE_RECORD_VERSION,
            state: "preparing",
            lease
          });

          try {
            await this.runGit(
              repository.repository,
              ["worktree", "add", "--detach", workspacePath, commit],
              input.signal
            );
            throwIfAborted(input.signal);
            await this.verifyPreparedWorktree(root, repository, lease, input.signal);
            await this.replaceLeaseRecord(recordPath, {
              version: LEASE_RECORD_VERSION,
              state: "ready",
              lease
            });
            return lease;
          } catch (error) {
            if (isAbortError(error)) {
              throw new WorkspaceManagerError(
                "WORKSPACE_ABORTED",
                "Workspace preparation was aborted; any partial worktree was retained",
                { cause: error }
              );
            }
            if (error instanceof WorkspaceManagerError) {
              throw error;
            }
            throw new WorkspaceManagerError(
              "WORKSPACE_PREPARE_FAILED",
              "Failed to prepare Git worktree; any partial worktree was retained",
              { cause: error }
            );
          }
        },
        input.signal
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_ABORTED",
          "Workspace preparation was aborted",
          { cause: error }
        );
      }
      throw error;
    }
  }

  async finalize(
    lease: WorkspaceLease,
    options: WorkspaceFinalizeOptions
  ): Promise<WorkspaceFinalizeResult> {
    if (options.retention !== "always" && options.retention !== "on-failure") {
      return {
        action: "retained",
        lease,
        reason: "cleanup-failed",
        error: {
          name: "WorkspaceManagerError",
          message: "Unknown workspace retention policy"
        }
      };
    }
    if (options.retention === "always") {
      return { action: "retained", lease, reason: "retention-policy" };
    }
    if (!options.succeeded) {
      return { action: "retained", lease, reason: "run-failed" };
    }
    return this.cleanup(lease, options.signal ? { signal: options.signal } : {});
  }

  async cleanup(
    lease: WorkspaceLease,
    options: WorkspaceCleanupOptions = {}
  ): Promise<WorkspaceFinalizeResult> {
    try {
      return await this.cleanupUnsafe(lease, options.signal, false);
    } catch (error) {
      return {
        action: "retained",
        lease,
        reason: "cleanup-failed",
        error: serializeError(error)
      };
    }
  }

  async discard(
    lease: WorkspaceLease,
    options: WorkspaceCleanupOptions = {}
  ): Promise<WorkspaceFinalizeResult> {
    try {
      return await this.cleanupUnsafe(lease, options.signal, true);
    } catch (error) {
      return {
        action: "retained",
        lease,
        reason: "cleanup-failed",
        error: serializeError(error)
      };
    }
  }

  async list(options: WorkspaceListOptions = {}): Promise<readonly WorkspaceLease[]> {
    try {
      if (options.namespace !== undefined) {
        assertSafeSegment(options.namespace, "namespace");
      }
      throwIfAborted(options.signal);

      const repositoryFilter = options.repository === undefined
        ? undefined
        : (await this.resolveRepository(options.repository, options.signal)).repository;
      const root = await this.ensureRoot();
      const leasesRoot = join(root, LEASES_DIRECTORY);
      const leasesRootStat = await lstatIfPresent(leasesRoot);
      if (!leasesRootStat) {
        return [];
      }
      if (!leasesRootStat.isDirectory() || leasesRootStat.isSymbolicLink()) {
        throw new WorkspaceManagerError(
          "WORKSPACE_PATH_ESCAPE",
          "Workspace lease directory is not a real directory"
        );
      }
      const canonicalLeasesRoot = await realpath(leasesRoot);
      if (!isSameOrDescendant(root, canonicalLeasesRoot)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_PATH_ESCAPE",
          "Workspace lease directory escapes the controlled root"
        );
      }

      const namespaces = options.namespace === undefined
        ? (await readdir(canonicalLeasesRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
          .map((entry) => entry.name)
        : [options.namespace];
      const leases: WorkspaceLease[] = [];

      for (const namespace of namespaces.sort()) {
        assertSafeSegment(namespace, "namespace");
        const namespaceDir = join(canonicalLeasesRoot, namespace);
        const namespaceStat = await lstatIfPresent(namespaceDir);
        if (!namespaceStat) {
          continue;
        }
        if (!namespaceStat.isDirectory() || namespaceStat.isSymbolicLink()) {
          throw new WorkspaceManagerError(
            "WORKSPACE_PATH_ESCAPE",
            "Workspace lease namespace is not a real directory"
          );
        }

        const entries = await readdir(namespaceDir, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) {
            continue;
          }
          const record = await this.readLeaseRecord(join(namespaceDir, entry.name), root);
          if (
            record.lease.namespace !== namespace
            || entry.name !== `${record.lease.key}.json`
          ) {
            throw new WorkspaceManagerError(
              "INVALID_WORKSPACE_LEASE",
              "Workspace lease record does not match its storage path"
            );
          }
          if (repositoryFilter && record.lease.repository !== repositoryFilter) {
            continue;
          }
          leases.push(record.lease);
        }
      }

      throwIfAborted(options.signal);
      return leases;
    } catch (error) {
      if (error instanceof WorkspaceManagerError && error.code === "WORKSPACE_ABORTED") {
        throw error;
      }
      throw new WorkspaceManagerError(
        "WORKSPACE_LIST_FAILED",
        "Failed to list managed Git worktrees",
        { cause: error }
      );
    }
  }

  private async cleanupUnsafe(
    lease: WorkspaceLease,
    signal?: AbortSignal,
    discardChanges = false
  ): Promise<WorkspaceFinalizeResult> {
    throwIfAborted(signal);
    const root = await this.ensureRoot();
    this.validateLeaseShape(lease, root);
    const repository = await this.resolveRepository(lease.repository, signal);
    if (repository.repository !== lease.repository) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        "Workspace lease repository is not canonical"
      );
    }

    return this.mutationLock.runExclusive(
      repository.commonDir,
      async () => {
        throwIfAborted(signal);
        const workspaceStat = await lstatIfPresent(lease.path);
        if (!workspaceStat) {
          const recordPath = join(
            root,
            LEASES_DIRECTORY,
            lease.namespace,
            `${lease.key}.json`
          );
          if (await lstatIfPresent(recordPath)) {
            await this.assertMatchingLeaseRecord(root, lease);
          }
          const metadataError = await this.removeLeaseRecord(root, lease);
          return {
            action: "absent",
            lease,
            reason: "missing",
            ...(metadataError ? { error: metadataError } : {})
          };
        }
        if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
          throw new WorkspaceManagerError(
            "WORKSPACE_PATH_ESCAPE",
            "Workspace path is not a real directory"
          );
        }

        const canonicalWorkspacePath = await realpath(lease.path);
        if (canonicalWorkspacePath !== lease.path || !isSameOrDescendant(root, canonicalWorkspacePath)) {
          throw new WorkspaceManagerError(
            "WORKSPACE_PATH_ESCAPE",
            "Workspace path escapes the controlled root"
          );
        }

        const record = await this.assertMatchingLeaseRecord(root, lease);

        let workspaceCommonDir: string;
        try {
          workspaceCommonDir = await this.resolveGitCommonDir(lease.path, signal);
        } catch (error) {
          if (record.state !== "preparing" || !discardChanges) {
            throw error;
          }
          return this.discardPartialWorkspace(root, repository, lease, signal);
        }
        if (workspaceCommonDir !== repository.commonDir) {
          throw new WorkspaceManagerError(
            "INVALID_WORKSPACE_LEASE",
            "Workspace belongs to a different Git repository"
          );
        }

        const head = (await this.runGit(
          lease.path,
          ["rev-parse", "--verify", "HEAD"],
          signal
        )).stdout.trim().toLowerCase();
        const branch = (await this.runGit(
          lease.path,
          ["rev-parse", "--abbrev-ref", "HEAD"],
          signal
        )).stdout.trim();
        if (head !== lease.commit || branch !== "HEAD") {
          return { action: "retained", lease, reason: "head-changed" };
        }

        const status = (await this.runGit(
          lease.path,
          ["status", "--porcelain=v1", "--untracked-files=all"],
          signal
        )).stdout;
        if (status.length > 0 && !discardChanges) {
          return { action: "retained", lease, reason: "dirty" };
        }

        try {
          await this.runGit(
            repository.repository,
            ["worktree", "remove", ...(discardChanges ? ["--force"] : []), lease.path],
            signal
          );
        } catch (error) {
          return {
            action: "retained",
            lease,
            reason: "cleanup-failed",
            error: serializeError(error)
          };
        }

        const metadataError = await this.removeLeaseRecord(root, lease);
        return {
          action: "removed",
          lease,
          ...(metadataError ? { error: metadataError } : {})
        };
      },
      signal
    );
  }

  private async resolveRepository(
    repositoryPath: string,
    signal?: AbortSignal
  ): Promise<RepositoryInfo> {
    const repository = await this.resolveRepositoryInfo(repositoryPath, signal);
    if (this.allowedRepositoryPaths !== undefined) {
      this.allowedRepositoriesPromise ??= Promise.all(
        this.allowedRepositoryPaths.map((allowedPath) => this.resolveRepositoryInfo(allowedPath))
      ).then((entries) => new Set(entries.map((entry) => entry.repository)));
      const allowedRepositories = await this.allowedRepositoriesPromise;
      if (!allowedRepositories.has(repository.repository)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_REPOSITORY_NOT_ALLOWED",
          "Repository is outside the host-authorized worktree repository set"
        );
      }
    }
    return repository;
  }

  private async resolveRepositoryInfo(
    repositoryPath: string,
    signal?: AbortSignal
  ): Promise<RepositoryInfo> {
    if (repositoryPath.trim().length === 0) {
      throw new WorkspaceManagerError("INVALID_REPOSITORY", "Repository path is required");
    }

    try {
      throwIfAborted(signal);
      const candidate = await realpath(resolve(repositoryPath));
      const topLevel = (await this.runGit(
        candidate,
        ["rev-parse", "--show-toplevel"],
        signal
      )).stdout.trim();
      const repository = await realpath(topLevel);
      const commonDir = await this.resolveGitCommonDir(repository, signal);
      return { repository, commonDir };
    } catch (error) {
      if (isAbortError(error)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_ABORTED",
          "Workspace operation was aborted while resolving the repository",
          { cause: error }
        );
      }
      if (error instanceof WorkspaceManagerError) {
        throw error;
      }
      throw new WorkspaceManagerError(
        "INVALID_REPOSITORY",
        "Repository path is not inside a Git working tree",
        { cause: error }
      );
    }
  }

  private async resolveGitCommonDir(cwd: string, signal?: AbortSignal): Promise<string> {
    const output = (await this.runGit(
      cwd,
      ["rev-parse", "--git-common-dir"],
      signal
    )).stdout.trim();
    return realpath(isAbsolute(output) ? output : resolve(cwd, output));
  }

  private async resolveCommit(
    repository: RepositoryInfo,
    ref: string,
    signal?: AbortSignal
  ): Promise<string> {
    try {
      const commit = (await this.runGit(
        repository.repository,
        ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
        signal
      )).stdout.trim().toLowerCase();
      if (!isCommitId(commit)) {
        throw new Error("Git returned an invalid commit object ID");
      }
      return commit;
    } catch (error) {
      if (isAbortError(error)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_ABORTED",
          "Workspace operation was aborted while resolving the Git ref",
          { cause: error }
        );
      }
      throw new WorkspaceManagerError(
        "INVALID_REF",
        `Git ref ${JSON.stringify(ref)} does not resolve to a commit`,
        { cause: error }
      );
    }
  }

  private async verifyPreparedWorktree(
    root: string,
    repository: RepositoryInfo,
    lease: WorkspaceLease,
    signal?: AbortSignal
  ): Promise<void> {
    const canonicalPath = await realpath(lease.path);
    if (canonicalPath !== lease.path || !isSameOrDescendant(root, canonicalPath)) {
      throw new WorkspaceManagerError(
        "WORKSPACE_PATH_ESCAPE",
        "Prepared worktree escapes the controlled root"
      );
    }

    const commonDir = await this.resolveGitCommonDir(lease.path, signal);
    const head = (await this.runGit(
      lease.path,
      ["rev-parse", "--verify", "HEAD"],
      signal
    )).stdout.trim().toLowerCase();
    const branch = (await this.runGit(
      lease.path,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      signal
    )).stdout.trim();

    if (commonDir !== repository.commonDir || head !== lease.commit || branch !== "HEAD") {
      throw new WorkspaceManagerError(
        "WORKSPACE_PREPARE_FAILED",
        "Git did not create the requested detached worktree"
      );
    }
  }

  private async runGit(
    cwd: string,
    args: readonly string[],
    signal?: AbortSignal
  ) {
    throwIfAborted(signal);
    try {
      const result = await this.commandRunner.run({
        cwd,
        args,
        ...(signal ? { signal } : {})
      });
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if ((error instanceof GitCommandError && error.aborted) || isAbortError(error)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_ABORTED",
          "Git command was aborted",
          { cause: error }
        );
      }
      throw error;
    }
  }

  private async ensureRoot(): Promise<string> {
    this.rootPromise ??= (async () => {
      await mkdir(this.configuredRoot, { recursive: true });
      const rootStat = await lstat(this.configuredRoot);
      if (!rootStat.isDirectory()) {
        throw new WorkspaceManagerError(
          "WORKSPACE_PATH_ESCAPE",
          "Workspace root is not a directory"
        );
      }
      return realpath(this.configuredRoot);
    })();
    return this.rootPromise;
  }

  private assertRootOutsideRepository(root: string, repository: string): void {
    if (isSameOrDescendant(repository, root)) {
      throw new WorkspaceManagerError(
        "WORKSPACE_ROOT_CONFLICT",
        "Workspace root must be outside the source repository"
      );
    }
  }

  private async ensureSafeDirectory(
    parent: string,
    segment: string,
    root: string
  ): Promise<string> {
    const path = join(parent, segment);
    try {
      await mkdir(path);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    const pathStat = await lstat(path);
    if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
      throw new WorkspaceManagerError(
        "WORKSPACE_PATH_ESCAPE",
        "Managed workspace directory contains a symlink or non-directory component"
      );
    }
    const canonicalPath = await realpath(path);
    if (!isSameOrDescendant(root, canonicalPath)) {
      throw new WorkspaceManagerError(
        "WORKSPACE_PATH_ESCAPE",
        "Managed workspace directory escapes the controlled root"
      );
    }
    return canonicalPath;
  }

  private async assertAvailable(workspacePath: string, recordPath: string): Promise<void> {
    if (await lstatIfPresent(workspacePath)) {
      throw new WorkspaceManagerError(
        "WORKSPACE_CONFLICT",
        "Workspace path already exists; the existing workspace was left untouched"
      );
    }
    if (await lstatIfPresent(recordPath)) {
      throw new WorkspaceManagerError(
        "WORKSPACE_CONFLICT",
        "Workspace key already has a retained lease"
      );
    }
  }

  private async createLeaseRecord(path: string, record: LeaseRecord): Promise<void> {
    try {
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new WorkspaceManagerError(
          "WORKSPACE_CONFLICT",
          "Workspace key already has a retained lease",
          { cause: error }
        );
      }
      throw error;
    }
  }

  private async replaceLeaseRecord(path: string, record: LeaseRecord): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readLeaseRecord(path: string, root: string): Promise<LeaseRecord> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        `Invalid workspace lease record at ${path}`,
        { cause: error }
      );
    }

    if (!this.isLeaseRecord(parsed)) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        `Invalid workspace lease record at ${path}`
      );
    }
    this.validateLeaseShape(parsed.lease, root);
    return parsed;
  }

  private async assertMatchingLeaseRecord(root: string, lease: WorkspaceLease): Promise<LeaseRecord> {
    const recordPath = join(
      root,
      LEASES_DIRECTORY,
      lease.namespace,
      `${lease.key}.json`
    );
    const record = await this.readLeaseRecord(recordPath, root);
    const recorded = record.lease;
    if (
      recorded.path !== lease.path
      || recorded.repository !== lease.repository
      || recorded.commit !== lease.commit
      || recorded.key !== lease.key
      || recorded.namespace !== lease.namespace
    ) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        "Workspace lease does not match its durable record"
      );
    }
    return record;
  }

  private async discardPartialWorkspace(
    root: string,
    repository: RepositoryInfo,
    lease: WorkspaceLease,
    signal?: AbortSignal
  ): Promise<WorkspaceFinalizeResult> {
    const registered = await this.isRegisteredWorktree(
      repository.repository,
      lease.path,
      signal
    );
    if (registered) {
      try {
        await this.runGit(
          repository.repository,
          ["worktree", "remove", "--force", lease.path],
          signal
        );
      } catch (error) {
        return {
          action: "retained",
          lease,
          reason: "cleanup-failed",
          error: serializeError(error)
        };
      }
    } else {
      await rm(lease.path, { recursive: true, force: true });
    }

    const metadataError = await this.removeLeaseRecord(root, lease);
    return {
      action: "removed",
      lease,
      ...(metadataError ? { error: metadataError } : {})
    };
  }

  private async isRegisteredWorktree(
    repository: string,
    workspacePath: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const output = (await this.runGit(
      repository,
      ["worktree", "list", "--porcelain", "-z"],
      signal
    )).stdout;
    return output
      .split("\0")
      .some((field) => field.startsWith("worktree ") && field.slice("worktree ".length) === workspacePath);
  }

  private isLeaseRecord(value: unknown): value is LeaseRecord {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value as Partial<LeaseRecord>;
    return candidate.version === LEASE_RECORD_VERSION
      && (candidate.state === "preparing" || candidate.state === "ready")
      && typeof candidate.lease === "object"
      && candidate.lease !== null;
  }

  private validateLeaseShape(lease: WorkspaceLease, root: string): void {
    assertSafeSegment(lease.key, "key");
    assertSafeSegment(lease.namespace, "namespace");
    if (!isCommitId(lease.commit)) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        "Workspace lease commit is invalid"
      );
    }
    const expectedPath = join(root, lease.namespace, lease.key);
    if (lease.path !== expectedPath || !isSameOrDescendant(root, expectedPath)) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        "Workspace lease path does not match its namespace and key"
      );
    }
    if (!isAbsolute(lease.repository)) {
      throw new WorkspaceManagerError(
        "INVALID_WORKSPACE_LEASE",
        "Workspace lease repository is not canonical"
      );
    }
  }

  private async removeLeaseRecord(
    root: string,
    lease: WorkspaceLease
  ): Promise<WorkspaceFinalizeError | undefined> {
    const leaseNamespaceDir = join(root, LEASES_DIRECTORY, lease.namespace);
    const recordPath = join(leaseNamespaceDir, `${lease.key}.json`);
    try {
      await rm(recordPath, { force: true });
      await rmdir(leaseNamespaceDir).catch(() => undefined);
      await rmdir(join(root, lease.namespace)).catch(() => undefined);
      return undefined;
    } catch (error) {
      return serializeError(error);
    }
  }
}
