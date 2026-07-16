import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChildProcessGitCommandRunner,
  GitCommandError
} from "../../../src/workspaces/index.js";

describe("ChildProcessGitCommandRunner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "openflow-git-runner-")));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("passes arguments directly without shell interpolation", async () => {
    const runner = new ChildProcessGitCommandRunner({ gitBinary: process.execPath });
    const literal = "$(printf unsafe);`printf unsafe`;*";
    const result = await runner.run({
      cwd: tempDir,
      args: ["-e", "process.stdout.write(process.argv[1])", literal]
    });

    expect(result.stdout).toBe(literal);
  });

  it("terminates an in-flight child process when its signal aborts", async () => {
    const runner = new ChildProcessGitCommandRunner({ gitBinary: process.execPath });
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = runner.run({
      cwd: tempDir,
      args: ["-e", "setInterval(() => {}, 10_000)"],
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 50);

    await expect(running).rejects.toMatchObject({
      name: "GitCommandError",
      aborted: true
    } satisfies Partial<GitCommandError>);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
