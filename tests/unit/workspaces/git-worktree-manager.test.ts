import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChildProcessGitCommandRunner,
  GitWorktreeManager,
  type GitCommandInput,
  type GitCommandResult,
  type GitCommandRunner,
  type WorkspaceLease
} from "../../../src/workspaces/index.js";

const gitRunner = new ChildProcessGitCommandRunner();

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await gitRunner.run({ cwd, args })).stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("GitWorktreeManager", () => {
  let tempDir: string;
  let repository: string;
  let rootDir: string;
  let initialCommit: string;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "openflow-worktrees-")));
    repository = join(tempDir, "source");
    rootDir = join(tempDir, "managed");
    await mkdir(repository);
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "OpenFlow Test"]);
    await git(repository, ["config", "user.email", "openflow@example.test"]);
    await writeFile(join(repository, "README.md"), "initial\n");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "initial"]);
    initialCommit = await git(repository, ["rev-parse", "HEAD"]);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("prepares a detached worktree at a canonical commit and removes it after clean success", async () => {
    const nestedDirectory = join(repository, "nested");
    await mkdir(nestedDirectory);
    const manager = new GitWorktreeManager({ rootDir });

    const lease = await manager.prepare({
      repository: nestedDirectory,
      ref: "HEAD",
      namespace: "run-001",
      key: "paper-reader"
    });

    expect(lease).toEqual({
      path: join(rootDir, "run-001", "paper-reader"),
      repository,
      commit: initialCommit,
      namespace: "run-001",
      key: "paper-reader"
    });
    expect(await git(lease.path, ["rev-parse", "HEAD"])).toBe(initialCommit);
    expect(await git(lease.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("HEAD");
    expect(await manager.list({ repository })).toEqual([lease]);

    const result = await manager.finalize(lease, {
      succeeded: true,
      retention: "on-failure"
    });

    expect(result).toEqual({ action: "removed", lease });
    expect(await pathExists(lease.path)).toBe(false);
    expect(await manager.list()).toEqual([]);
    expect(await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
  });

  it("safely prepares 20 different worktrees concurrently without changing the source", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const statusBefore = await git(repository, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ]);

    const leases = await Promise.all(
      Array.from({ length: 20 }, (_, index) => manager.prepare({
        repository,
        ref: initialCommit,
        namespace: "run-concurrent",
        key: `worker-${String(index).padStart(2, "0")}`
      }))
    );

    expect(new Set(leases.map((lease) => lease.path)).size).toBe(20);
    for (const lease of leases) {
      expect(await git(lease.path, ["rev-parse", "HEAD"])).toBe(initialCommit);
      expect(await git(lease.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("HEAD");
    }
    expect(await manager.list({ namespace: "run-concurrent" })).toEqual(leases);
    expect(await git(repository, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ])).toBe(statusBefore);
  }, 30_000);

  it("retains a dirty worktree and removes it only after it becomes clean", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const lease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-dirty",
      key: "worker"
    });
    const dirtyFile = join(lease.path, "candidate.md");
    await writeFile(dirtyFile, "candidate\n");

    const retained = await manager.finalize(lease, {
      succeeded: true,
      retention: "on-failure"
    });

    expect(retained).toEqual({ action: "retained", lease, reason: "dirty" });
    expect(await pathExists(dirtyFile)).toBe(true);
    expect(await manager.list()).toEqual([lease]);

    await rm(dirtyFile);
    expect(await manager.cleanup(lease)).toEqual({ action: "removed", lease });
  });

  it("explicitly discards a dirty candidate while still verifying the lease commit", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const lease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-discard",
      key: "accepted-candidate"
    });
    await writeFile(join(lease.path, "candidate.md"), "accepted elsewhere\n");

    const result = await manager.discard(lease);

    expect(result).toEqual({ action: "removed", lease });
    expect(await pathExists(lease.path)).toBe(false);
    expect(await manager.list({ namespace: "run-discard" })).toEqual([]);
  });

  it("retains failed runs and honors the always retention policy", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const failedLease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-retain",
      key: "failed"
    });
    const alwaysLease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-retain",
      key: "always"
    });

    expect(await manager.finalize(failedLease, {
      succeeded: false,
      retention: "on-failure"
    })).toEqual({ action: "retained", lease: failedLease, reason: "run-failed" });
    expect(await manager.finalize(alwaysLease, {
      succeeded: true,
      retention: "always"
    })).toEqual({ action: "retained", lease: alwaysLease, reason: "retention-policy" });
    expect(await pathExists(failedLease.path)).toBe(true);
    expect(await pathExists(alwaysLease.path)).toBe(true);
  });

  it("retains a clean worktree when its detached HEAD moved", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const lease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-head",
      key: "worker"
    });
    await writeFile(join(lease.path, "candidate.md"), "candidate\n");
    await git(lease.path, ["add", "candidate.md"]);
    await git(lease.path, ["commit", "-m", "candidate"]);
    expect(await git(lease.path, ["status", "--porcelain=v1"])).toBe("");

    const result = await manager.finalize(lease, {
      succeeded: true,
      retention: "on-failure"
    });

    expect(result).toEqual({ action: "retained", lease, reason: "head-changed" });
    expect(await pathExists(join(lease.path, "candidate.md"))).toBe(true);
  });

  it("returns a structured retained result when Git refuses cleanup", async () => {
    class FailingRemoveRunner implements GitCommandRunner {
      failRemove = false;

      async run(input: GitCommandInput): Promise<GitCommandResult> {
        if (
          this.failRemove
          && input.args[0] === "worktree"
          && input.args[1] === "remove"
        ) {
          throw new Error("simulated remove failure");
        }
        return gitRunner.run(input);
      }
    }

    const commandRunner = new FailingRemoveRunner();
    const manager = new GitWorktreeManager({ rootDir, commandRunner });
    const lease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-remove-failure",
      key: "worker"
    });
    commandRunner.failRemove = true;

    const result = await manager.finalize(lease, {
      succeeded: true,
      retention: "on-failure"
    });

    expect(result).toMatchObject({
      action: "retained",
      lease,
      reason: "cleanup-failed",
      error: { name: "Error", message: "simulated remove failure" }
    });
    expect(await pathExists(lease.path)).toBe(true);
  });

  it("never follows a forged lease path outside the managed root during cleanup", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const lease = await manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-forged",
      key: "worker"
    });
    const outsideFile = join(tempDir, "do-not-delete.txt");
    await writeFile(outsideFile, "keep\n");

    const result = await manager.cleanup({ ...lease, path: tempDir });

    expect(result).toMatchObject({
      action: "retained",
      reason: "cleanup-failed",
      error: { name: "WorkspaceManagerError" }
    });
    expect(await pathExists(outsideFile)).toBe(true);
    expect(await pathExists(lease.path)).toBe(true);
  });

  it("never discards an unmanaged worktree without a matching durable lease", async () => {
    const namespace = "run-unmanaged";
    const key = "worker";
    const unmanagedPath = join(rootDir, namespace, key);
    await mkdir(join(rootDir, namespace), { recursive: true });
    await git(repository, ["worktree", "add", "--detach", unmanagedPath, initialCommit]);
    const manager = new GitWorktreeManager({ rootDir });
    const forgedLease: WorkspaceLease = {
      path: unmanagedPath,
      repository,
      commit: initialCommit,
      namespace,
      key
    };

    const result = await manager.discard(forgedLease);

    expect(result).toMatchObject({
      action: "retained",
      reason: "cleanup-failed",
      error: { name: "WorkspaceManagerError" }
    });
    expect(await pathExists(unmanagedPath)).toBe(true);
    expect(await git(unmanagedPath, ["rev-parse", "HEAD"])).toBe(initialCommit);
  });

  it.each([
    { key: "../escape", namespace: "run-safe", code: "INVALID_WORKSPACE_KEY" },
    { key: "worker/escape", namespace: "run-safe", code: "INVALID_WORKSPACE_KEY" },
    { key: "worker", namespace: "../escape", code: "INVALID_WORKSPACE_NAMESPACE" },
    { key: "worker", namespace: ".leases", code: "INVALID_WORKSPACE_NAMESPACE" }
  ])("rejects unsafe key or namespace $key / $namespace", async ({ key, namespace, code }) => {
    const manager = new GitWorktreeManager({ rootDir });

    await expect(manager.prepare({ repository, ref: "HEAD", key, namespace }))
      .rejects.toMatchObject({ code });
    expect(await pathExists(join(tempDir, "escape"))).toBe(false);
  });

  it("rejects a symlinked namespace that escapes the controlled root", async () => {
    const outside = join(tempDir, "outside");
    await mkdir(rootDir);
    await mkdir(outside);
    await symlink(outside, join(rootDir, "run-link"));
    const manager = new GitWorktreeManager({ rootDir });

    await expect(manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-link",
      key: "worker"
    })).rejects.toMatchObject({ code: "WORKSPACE_PATH_ESCAPE" });
    expect(await pathExists(join(outside, "worker"))).toBe(false);
  });

  it("rejects a managed root inside the source repository before creating it", async () => {
    const inRepositoryRoot = join(repository, ".managed-worktrees");
    const manager = new GitWorktreeManager({ rootDir: inRepositoryRoot });

    await expect(manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-root",
      key: "worker"
    })).rejects.toMatchObject({ code: "WORKSPACE_ROOT_CONFLICT" });
    expect(await pathExists(inRepositoryRoot)).toBe(false);
  });

  it("rejects duplicate paths without reusing or deleting the existing worktree", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const request = {
      repository,
      ref: "HEAD",
      namespace: "run-conflict",
      key: "worker"
    };
    const lease = await manager.prepare(request);

    await expect(manager.prepare(request)).rejects.toMatchObject({
      code: "WORKSPACE_CONFLICT"
    });
    expect(await git(lease.path, ["rev-parse", "HEAD"])).toBe(initialCommit);
  });

  it("rejects a non-Git repository and a ref that is not a commit", async () => {
    const nonRepository = join(tempDir, "plain");
    await mkdir(nonRepository);
    const manager = new GitWorktreeManager({ rootDir });

    await expect(manager.prepare({
      repository: nonRepository,
      ref: "HEAD",
      namespace: "run-invalid",
      key: "worker"
    })).rejects.toMatchObject({ code: "INVALID_REPOSITORY" });
    await expect(manager.prepare({
      repository,
      ref: "refs/heads/does-not-exist",
      namespace: "run-invalid",
      key: "worker"
    })).rejects.toMatchObject({ code: "INVALID_REF" });
  });

  it("enforces the host repository allowlist", async () => {
    const otherRepository = join(tempDir, "other-source");
    await mkdir(otherRepository);
    await git(otherRepository, ["init"]);
    await git(otherRepository, ["config", "user.name", "OpenFlow Test"]);
    await git(otherRepository, ["config", "user.email", "openflow@example.test"]);
    await writeFile(join(otherRepository, "README.md"), "other\n");
    await git(otherRepository, ["add", "README.md"]);
    await git(otherRepository, ["commit", "-m", "initial"]);
    const manager = new GitWorktreeManager({
      rootDir,
      allowedRepositories: [repository]
    });

    await expect(manager.prepare({
      repository: otherRepository,
      ref: "HEAD",
      namespace: "run-other",
      key: "worker"
    })).rejects.toMatchObject({ code: "WORKSPACE_REPOSITORY_NOT_ALLOWED" });
    expect(await pathExists(join(rootDir, "run-other", "worker"))).toBe(false);
  });

  it("retains a partial worktree and durable lease record when Git add fails", async () => {
    class FailingWorktreeAddRunner implements GitCommandRunner {
      async run(input: GitCommandInput): Promise<GitCommandResult> {
        if (input.args[0] === "worktree" && input.args[1] === "add") {
          const worktreePath = input.args[3]!;
          await mkdir(worktreePath);
          await writeFile(join(worktreePath, "partial.txt"), "partial\n");
          throw new Error("simulated worktree add failure");
        }
        return gitRunner.run(input);
      }
    }

    const manager = new GitWorktreeManager({
      rootDir,
      commandRunner: new FailingWorktreeAddRunner()
    });
    const expectedPath = join(rootDir, "run-partial", "worker");

    await expect(manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-partial",
      key: "worker"
    })).rejects.toMatchObject({ code: "WORKSPACE_PREPARE_FAILED" });
    expect(await pathExists(join(expectedPath, "partial.txt"))).toBe(true);
    expect(await manager.list()).toEqual([{
      path: expectedPath,
      repository,
      commit: initialCommit,
      namespace: "run-partial",
      key: "worker"
    } satisfies WorkspaceLease]);
    expect(await manager.discard({
      path: expectedPath,
      repository,
      commit: initialCommit,
      namespace: "run-partial",
      key: "worker"
    })).toEqual({
      action: "removed",
      lease: {
        path: expectedPath,
        repository,
        commit: initialCommit,
        namespace: "run-partial",
        key: "worker"
      }
    });
    expect(await pathExists(expectedPath)).toBe(false);
    expect(await manager.list()).toEqual([]);
  });

  it("does not create a worktree when preparation is already aborted", async () => {
    const manager = new GitWorktreeManager({ rootDir });
    const controller = new AbortController();
    controller.abort();

    await expect(manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-abort",
      key: "worker",
      signal: controller.signal
    })).rejects.toMatchObject({ code: "WORKSPACE_ABORTED" });
    expect(await pathExists(rootDir)).toBe(false);
  });

  it("aborts an in-flight worktree add and keeps its lease for inspection", async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      notifyStarted = resolveStarted;
    });

    class BlockingWorktreeAddRunner implements GitCommandRunner {
      async run(input: GitCommandInput): Promise<GitCommandResult> {
        if (input.args[0] !== "worktree" || input.args[1] !== "add") {
          return gitRunner.run(input);
        }

        const worktreePath = input.args[3]!;
        await mkdir(worktreePath);
        await writeFile(join(worktreePath, "partial.txt"), "partial\n");
        notifyStarted();
        return new Promise((_resolve, reject) => {
          const rejectAborted = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (input.signal?.aborted) {
            rejectAborted();
            return;
          }
          input.signal?.addEventListener("abort", rejectAborted, { once: true });
        });
      }
    }

    const manager = new GitWorktreeManager({
      rootDir,
      commandRunner: new BlockingWorktreeAddRunner()
    });
    const controller = new AbortController();
    const preparation = manager.prepare({
      repository,
      ref: "HEAD",
      namespace: "run-abort",
      key: "worker",
      signal: controller.signal
    });
    await started;
    controller.abort();

    await expect(preparation).rejects.toMatchObject({ code: "WORKSPACE_ABORTED" });
    expect(await manager.list()).toEqual([{
      path: join(rootDir, "run-abort", "worker"),
      repository,
      commit: initialCommit,
      namespace: "run-abort",
      key: "worker"
    } satisfies WorkspaceLease]);
    const lease: WorkspaceLease = {
      path: join(rootDir, "run-abort", "worker"),
      repository,
      commit: initialCommit,
      namespace: "run-abort",
      key: "worker"
    };
    expect(await manager.discard(lease)).toEqual({ action: "removed", lease });
    expect(await pathExists(lease.path)).toBe(false);
    expect(await manager.list()).toEqual([]);
  });
});
