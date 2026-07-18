import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createOpenFlow } from "../../src/sdk/index.js";
import { ChildProcessGitCommandRunner } from "../../src/workspaces/index.js";

const TEMP_DIR = path.resolve("tests/temp-sdk-client");

async function collectEvents(run: { events: AsyncIterable<any>; result: Promise<any> }) {
  const events: any[] = [];
  for await (const event of run.events) {
    events.push(event);
  }
  const result = await run.result;
  return { events, result };
}

describe("OpenFlow SDK client", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("runs a workflow and exposes live events, report inspection, and run listing", async () => {
    const runsDir = path.join(TEMP_DIR, "runs");
    const workflowPath = path.join(TEMP_DIR, "workflows/basic.ts");
    await fs.writeFile(workflowPath, `
export const meta = { name: "sdk-basic", description: "test" };

const answer = await agent({ id: "hello", provider: "mock", prompt: "Say hello." });

export default { answer };
`, "utf8");

    const openflow = createOpenFlow({
      workspace: { cwd: TEMP_DIR, runsDir }
    });

    const run = await openflow.run({
      workflow: { kind: "file", path: workflowPath },
      args: { topic: "sdk" }
    });
    const { events, result } = await collectEvents(run);

    expect(result.status).toBe("succeeded");
    expect(result.result).toMatchObject({ answer: { text: "mock response", provider: "mock" } });
    expect(result.artifactsDir).toBe(path.join(runsDir, run.runId));
    expect(events.map((event) => event.type)).toContain("workflow.started");
    expect(events.map((event) => event.type)).toContain("agent.output");
    expect(events.at(-1)?.type).toBe("workflow.completed");

    const inspected = await openflow.inspectRun({ runId: run.runId });
    expect(inspected.report?.status).toBe("succeeded");
    const runs = await openflow.listRuns();
    expect(runs[0]).toMatchObject({ runId: run.runId, status: "succeeded" });
  });

  it("passes SDK provider env overrides to child processes without widening security.passEnv", async () => {
    const runsDir = path.join(TEMP_DIR, "runs");
    const workflowPath = path.join(TEMP_DIR, "workflows/provider-env.ts");
    await fs.writeFile(workflowPath, `
export const meta = { name: "sdk-provider-env", description: "test provider environment override" };

const answer = await agent({ id: "home", provider: "codex", prompt: "Print the configured HOME." });

export default { answer };
`, "utf8");

    const openflow = createOpenFlow({
      workspace: { cwd: TEMP_DIR, runsDir }
    });
    const isolatedHome = path.join(TEMP_DIR, "isolated-home");
    const run = await openflow.run({
      workflow: { kind: "file", path: workflowPath },
      providers: {
        codex: {
          command: process.execPath,
          args: ["-e", "process.stdout.write(process.env.HOME ?? '')"],
          env: { HOME: isolatedHome }
        }
      }
    });
    const { result } = await collectEvents(run);

    expect(result.status).toBe("succeeded");
    expect(result.result).toMatchObject({ answer: { text: isolatedHome } });

    const invocation = JSON.parse(await fs.readFile(
      path.join(result.artifactsDir, "agents/home/provider-invocation.json"),
      "utf8"
    ));
    expect(invocation.requested.explicitEnvironmentKeys).toEqual(["HOME"]);
    expect(invocation.spawn.environmentKeys).toContain("HOME");
  });

  it("persists explicitly public workflow metadata in the agent artifact", async () => {
    const runsDir = path.join(TEMP_DIR, "runs");
    const workflowPath = path.join(TEMP_DIR, "workflows/audit-metadata.ts");
    await fs.writeFile(workflowPath, `
export const meta = { name: "sdk-audit-metadata", description: "test public audit metadata" };

const answer = await agent({
  id: "audited",
  provider: "mock",
  prompt: "Say hello.",
  metadata: {
    "audit.example.campaignId": "campaign-42",
    "audit.example.answerOrdinal": 3
  }
});

export default { answer };
`, "utf8");

    const openflow = createOpenFlow({
      workspace: { cwd: TEMP_DIR, runsDir }
    });
    const run = await openflow.run({ workflow: { kind: "file", path: workflowPath } });
    const { result } = await collectEvents(run);

    expect(result.status).toBe("succeeded");
    const metadata = JSON.parse(await fs.readFile(
      path.join(result.artifactsDir, "agents/audited/metadata.json"),
      "utf8"
    ));
    expect(metadata).toMatchObject({
      "audit.example.campaignId": "campaign-42",
      "audit.example.answerOrdinal": 3
    });
  });

  it("runs a managed worktree through the public SDK composition root", async () => {
    const repository = path.join(TEMP_DIR, "repository");
    const runsDir = path.join(TEMP_DIR, "runs");
    const worktreesDir = path.join(TEMP_DIR, "worktrees");
    const workflowPath = path.join(repository, "workflows/worktree.ts");
    const git = new ChildProcessGitCommandRunner();
    await fs.mkdir(path.dirname(workflowPath), { recursive: true });
    await fs.writeFile(path.join(repository, "README.md"), "authority\n");
    await fs.writeFile(workflowPath, `
export const meta = { name: "sdk-worktree", description: "test managed workspace" };

const answer = await agent({
  id: "worker",
  provider: "mock",
  prompt: "Inspect this checkout without editing it.",
  workspace: {
    mode: "git-worktree",
    repository: ".",
    ref: "HEAD",
    key: "worker",
    retention: "on-failure"
  }
});

export default { answer };
`, "utf8");
    await git.run({ cwd: repository, args: ["init"] });
    await git.run({ cwd: repository, args: ["config", "user.name", "OpenFlow Test"] });
    await git.run({ cwd: repository, args: ["config", "user.email", "openflow@example.test"] });
    await git.run({ cwd: repository, args: ["add", "."] });
    await git.run({ cwd: repository, args: ["commit", "-m", "initial"] });

    const openflow = createOpenFlow({
      workspace: { cwd: repository, runsDir, worktreesDir }
    });
    const run = await openflow.run({ workflow: { kind: "file", path: workflowPath } });
    const { result } = await collectEvents(run);

    expect(result.status).toBe("succeeded");
    const workspaceArtifact = result.agents[0]?.artifacts.workspacePath;
    expect(workspaceArtifact).toBe("agents/worker/workspace.json");
    const receipt = JSON.parse(await fs.readFile(
      path.join(result.artifactsDir, workspaceArtifact!),
      "utf8"
    ));
    expect(receipt).toMatchObject({
      state: "finalized",
      requested: { mode: "git-worktree", repository, key: "worker" },
      finalization: { action: "removed" }
    });
    await expect(fs.access(receipt.lease.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await git.run({
      cwd: repository,
      args: ["status", "--porcelain=v1", "--untracked-files=all"]
    })).stdout).toBe("");
  });
});
