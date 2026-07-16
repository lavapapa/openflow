import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import * as registryModule from "../../../src/agents/registry.js";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";
import { WorkspaceManagerError } from "../../../src/workspaces/index.js";
import type {
  WorkspaceFinalizeResult,
  WorkspaceLease,
  WorkspaceManager
} from "../../../src/workspaces/index.js";
import type { AgentExecutionInput, AgentExecutor } from "../../../src/agents/execution-types.js";
import type { AgentRunInput } from "../../../src/types/agent.js";

const TEST_ROOT = path.resolve("tests/temp-execute-agent-workspace");

interface HarnessOptions {
  runId: string;
  execute?: (input: AgentRunInput) => Promise<Record<string, unknown>>;
  prepare?: WorkspaceManager["prepare"];
  finalize?: WorkspaceManager["finalize"];
  list?: WorkspaceManager["list"];
}

async function createHarness(options: HarnessOptions) {
  const repository = path.join(TEST_ROOT, options.runId, "repository");
  const worktree = path.join(TEST_ROOT, options.runId, "worktree");
  const runsRoot = path.join(TEST_ROOT, options.runId, "runs");
  await fs.mkdir(repository, { recursive: true });
  await fs.mkdir(worktree, { recursive: true });

  const lease: WorkspaceLease = {
    path: worktree,
    repository,
    commit: "a".repeat(40),
    key: "paper-001",
    namespace: options.runId
  };
  const defaultFinalization: WorkspaceFinalizeResult = {
    action: "retained",
    lease,
    reason: "retention-policy"
  };

  const prepare = vi.fn(options.prepare ?? (async () => lease));
  const finalize = vi.fn(options.finalize ?? (async () => defaultFinalization));
  const list = vi.fn(options.list ?? (async () => []));
  const manager: WorkspaceManager = {
    prepare,
    finalize,
    cleanup: vi.fn(async (candidate) => ({ action: "removed", lease: candidate })),
    discard: vi.fn(async (candidate) => ({ action: "removed", lease: candidate })),
    list
  };

  const providerInputs: AgentRunInput[] = [];
  const buildInputs: AgentRunInput[] = [];
  const sdkExecute = vi.fn(async (input: AgentRunInput) => {
    providerInputs.push(input);
    if (options.execute) return options.execute(input);
    return {
      exitCode: 0,
      parsed: {
        text: "workspace result",
        raw: { text: "workspace result" }
      }
    };
  });
  const adapter = {
    name: "workspace-sdk",
    kind: "sdk",
    buildCommand: vi.fn(async (input: AgentRunInput) => {
      buildInputs.push(input);
      return {
        command: "<sdk:workspace-sdk>",
        args: [input.id],
        cwd: input.cwd
      };
    }),
    parseResult: vi.fn(async () => ({ text: "unexpected parser call" })),
    execute: sdkExecute
  };
  vi.spyOn(registryModule, "createDefaultProviderRegistry").mockImplementation(() => ({
    get: () => adapter,
    list: () => [adapter],
    register: () => undefined
  } as any));

  const config: any = {
    defaultProvider: "workspace-sdk",
    providers: {
      "workspace-sdk": {
        command: "workspace-sdk",
        defaultModel: "workspace-model"
      }
    },
    security: {
      allowWorkflowImports: false,
      passEnv: [],
      redactEnv: []
    }
  };
  const store = new FileSystemArtifactStore({ rootDir: runsRoot });
  const runOutDir = path.join(runsRoot, options.runId);
  await store.createRun({
    runId: options.runId,
    outDir: runOutDir,
    workflowPath: "dummy.ts",
    workflowSource: "",
    workflowHash: "hash",
    resolvedConfig: config,
    openDynamicWorkflowVersion: "1.0.0",
    cwd: repository
  });
  const events: any[] = [];
  const eventBus = new EventBus({
    runId: options.runId,
    artifactStore: store,
    subscribers: [{ handle: (event) => events.push(event) }]
  });
  const executor: AgentExecutor = new DefaultAgentExecutor({
    config,
    artifactStore: store,
    eventBus,
    workspaceManager: manager,
    workspaceNamespace: options.runId
  });
  const signal = new AbortController().signal;
  const input: AgentExecutionInput = {
    id: "workspace-agent",
    provider: "workspace-sdk" as any,
    prompt: "Edit the candidate workspace.",
    model: "workspace-model",
    timeoutMs: 5000,
    cwd: repository,
    permissions: { mode: "default" },
    signal,
    workspace: {
      mode: "git-worktree",
      repository,
      ref: "HEAD",
      key: lease.key,
      retention: "always"
    }
  };

  return {
    adapter,
    buildInputs,
    eventBus,
    events,
    executor,
    finalize,
    input,
    lease,
    list,
    manager,
    prepare,
    providerInputs,
    repository,
    runOutDir,
    sdkExecute,
    signal,
    worktree
  };
}

async function readReceipt(runOutDir: string) {
  return JSON.parse(await fs.readFile(
    path.join(runOutDir, "agents/workspace-agent/workspace.json"),
    "utf8"
  ));
}

describe("DefaultAgentExecutor git worktree lifecycle", () => {
  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("prepares before provider execution, exposes only the lease cwd, then finalizes", async () => {
    const harness = await createHarness({ runId: "success" });

    const result = await harness.executor.execute(harness.input);
    await harness.eventBus.drain();

    expect(result.ok).toBe(true);
    expect(harness.prepare).toHaveBeenCalledWith({
      repository: harness.repository,
      ref: "HEAD",
      key: "paper-001",
      namespace: "success",
      signal: harness.signal
    });
    expect(harness.providerInputs).toHaveLength(1);
    expect(harness.buildInputs).toHaveLength(1);
    const providerInput = harness.providerInputs[0]!;
    for (const adapterInput of [harness.buildInputs[0]!, providerInput]) {
      expect(adapterInput.cwd).toBe(harness.worktree);
      expect(adapterInput.workspace).toBeUndefined();
      expect(adapterInput).not.toHaveProperty("repository");
      expect(adapterInput).not.toHaveProperty("ref");
      expect(adapterInput).not.toHaveProperty("key");
      expect(adapterInput).not.toHaveProperty("lease");
      expect(adapterInput.metadata ?? {}).not.toHaveProperty("workspaceMode");
      expect(adapterInput.metadata ?? {}).not.toHaveProperty("workspaceKey");
      expect(adapterInput.metadata ?? {}).not.toHaveProperty("workspaceRef");
    }
    expect(harness.finalize).toHaveBeenCalledWith(harness.lease, {
      succeeded: true,
      retention: "always"
    });
    expect(result.artifacts.workspacePath).toBe("agents/workspace-agent/workspace.json");

    const receipt = await readReceipt(harness.runOutDir);
    expect(receipt).toMatchObject({
      schemaVersion: "open-dynamic-workflow.agent-workspace.v1",
      state: "finalized",
      requested: {
        repository: harness.repository,
        ref: "HEAD",
        key: "paper-001",
        retention: "always",
        namespace: "success"
      },
      lease: harness.lease,
      finalization: {
        action: "retained",
        reason: "retention-policy"
      }
    });

    const eventTypes = harness.events.map((event) => event.type);
    expect(eventTypes.indexOf("agent.workspace.prepared")).toBeLessThan(eventTypes.indexOf("agent.verbose.command"));
    expect(eventTypes.indexOf("agent.verbose.result")).toBeLessThan(eventTypes.indexOf("agent.workspace.finalized"));
    expect(eventTypes).not.toContain("agent.workspace.failed");
  });

  it("finalizes cancelled provider execution without reusing the aborted provider signal", async () => {
    const controller = new AbortController();
    const harness = await createHarness({
      runId: "cancelled",
      execute: async () => {
        controller.abort("cancel provider");
        return { exitCode: null, cancelled: true };
      },
      finalize: async (lease, options) => ({
        action: "retained",
        lease,
        reason: options.succeeded ? "retention-policy" : "run-failed"
      })
    });
    harness.input.signal = controller.signal;
    if (harness.input.workspace?.mode === "git-worktree") {
      harness.input.workspace.retention = "on-failure";
    }

    const result = await harness.executor.execute(harness.input);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("cancelled");
    expect(harness.finalize).toHaveBeenCalledWith(harness.lease, {
      succeeded: false,
      retention: "on-failure"
    });
    expect(harness.finalize.mock.calls[0]![1]).not.toHaveProperty("signal");
    expect((await readReceipt(harness.runOutDir)).finalization).toMatchObject({
      action: "retained",
      reason: "run-failed"
    });
  });

  it("records a partial lease when preparation fails and never invokes the provider", async () => {
    const partialLease: WorkspaceLease = {
      path: path.join(TEST_ROOT, "prepare-failed", "partial"),
      repository: path.join(TEST_ROOT, "prepare-failed", "repository"),
      commit: "b".repeat(40),
      key: "paper-001",
      namespace: "prepare-failed"
    };
    const harness = await createHarness({
      runId: "prepare-failed",
      prepare: async () => {
        throw new WorkspaceManagerError("WORKSPACE_PREPARE_FAILED", "git worktree add failed");
      },
      list: async () => [partialLease]
    });

    const result = await harness.executor.execute(harness.input);
    await harness.eventBus.drain();

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("WORKSPACE_PREPARE_FAILED");
    expect(result.artifacts.workspacePath).toBe("agents/workspace-agent/workspace.json");
    expect(harness.sdkExecute).not.toHaveBeenCalled();
    expect(harness.finalize).not.toHaveBeenCalled();
    expect(harness.list).toHaveBeenCalledWith({ namespace: "prepare-failed" });

    const receipt = await readReceipt(harness.runOutDir);
    expect(receipt.state).toBe("failed");
    expect(receipt.lease).toEqual(partialLease);
    expect(receipt.error.code).toBe("WORKSPACE_PREPARE_FAILED");
    const failedEvent = harness.events.find((event) => event.type === "agent.workspace.failed");
    expect(failedEvent.payload).toMatchObject({
      operation: "prepare",
      lease: partialLease,
      error: { code: "WORKSPACE_PREPARE_FAILED" }
    });
  });

  it("keeps the provider success when finalization throws and audits the failure", async () => {
    const harness = await createHarness({
      runId: "finalize-failed",
      finalize: async () => {
        throw new WorkspaceManagerError("INVALID_WORKSPACE_LEASE", "lease rejected");
      }
    });

    const result = await harness.executor.execute(harness.input);
    await harness.eventBus.drain();

    expect(result.ok).toBe(true);
    const receipt = await readReceipt(harness.runOutDir);
    expect(receipt).toMatchObject({
      state: "failed",
      lease: harness.lease,
      error: { code: "INVALID_WORKSPACE_LEASE" }
    });
    const failedEvent = harness.events.find((event) =>
      event.type === "agent.workspace.failed" && event.payload.operation === "finalize"
    );
    expect(failedEvent.payload.error.code).toBe("INVALID_WORKSPACE_LEASE");
  });

  it("records a structured cleanup failure without replacing the provider result", async () => {
    const harness = await createHarness({
      runId: "cleanup-failed",
      finalize: async (lease) => ({
        action: "retained",
        lease,
        reason: "cleanup-failed",
        error: { name: "GitCommandError", message: "git worktree remove failed" }
      })
    });

    const result = await harness.executor.execute(harness.input);
    await harness.eventBus.drain();

    expect(result.ok).toBe(true);
    expect((await readReceipt(harness.runOutDir)).finalization).toMatchObject({
      action: "retained",
      reason: "cleanup-failed",
      error: { name: "GitCommandError", message: "git worktree remove failed" }
    });
    expect(harness.events.some((event) => event.type === "agent.workspace.finalized")).toBe(true);
    expect(harness.events.some((event) =>
      event.type === "agent.workspace.failed"
      && event.payload.operation === "finalize"
      && event.payload.error.message === "git worktree remove failed"
    )).toBe(true);
  });

  it("does not prepare a worktree when the scheduler signal is already timed out", async () => {
    const harness = await createHarness({ runId: "pre-aborted" });
    const controller = new AbortController();
    controller.abort("Task workspace-agent timed out after 10ms");
    harness.input.signal = controller.signal;

    const result = await harness.executor.execute(harness.input);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("timed_out");
    expect(result.error.code).toBe("WORKSPACE_ABORTED");
    expect(harness.prepare).not.toHaveBeenCalled();
    expect(harness.sdkExecute).not.toHaveBeenCalled();
    expect(harness.finalize).not.toHaveBeenCalled();
  });
});
