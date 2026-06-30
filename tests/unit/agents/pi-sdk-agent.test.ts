import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPiSdkSessionManager, PiSdkAgentAdapter } from "../../../src/agents/pi-sdk-agent.js";

function runInput(overrides: any = {}) {
  return {
    id: "pi-sdk-agent",
    provider: "pi-sdk",
    prompt: "hello",
    model: "deepseek-chat",
    timeoutMs: 1000,
    cwd: process.cwd(),
    env: {},
    permissions: { mode: "default" },
    ...overrides
  };
}

describe("PiSdkAgentAdapter", () => {
  it("uses a virtual SDK command for verbose metadata", async () => {
    const adapter = new PiSdkAgentAdapter({
      command: "pi-sdk",
      defaultModel: "deepseek-chat",
      piProvider: "deepseek"
    });

    const command = await adapter.buildCommand(runInput({ model: undefined }));

    expect(command.command).toBe("<sdk:pi>");
    expect(command.args).toEqual(["--provider", "deepseek", "--model", "deepseek-chat"]);
    expect(command.cwd).toBe(process.cwd());
  });

  it("requires a Pi provider and model before execution", async () => {
    const noProvider = new PiSdkAgentAdapter({ command: "pi-sdk", defaultModel: "m" });
    await expect(noProvider.buildCommand(runInput())).rejects.toMatchObject({
      code: "MODEL_CONFIG_INVALID"
    });

    const noModel = new PiSdkAgentAdapter({ command: "pi-sdk", defaultModel: null, piProvider: "deepseek" });
    await expect(noModel.buildCommand(runInput({ model: undefined }))).rejects.toMatchObject({
      code: "MODEL_CONFIG_INVALID"
    });
  });

  it("reports SDK package health and parses fallback stdout", async () => {
    const adapter = new PiSdkAgentAdapter({
      command: "pi-sdk",
      defaultModel: "deepseek-chat",
      piProvider: "deepseek"
    });

    await expect(adapter.checkHealth()).resolves.toMatchObject({
      provider: "pi-sdk",
      available: true,
      supportsModelSelection: true
    });
    await expect(adapter.parseResult({
      input: runInput(),
      stdout: "hello from sdk",
      stderr: "",
      exitCode: 0
    })).resolves.toMatchObject({
      text: "hello from sdk"
    });
  });

  it("uses an in-memory Pi session by default", () => {
    const SessionManager = fakeSessionManager();

    createPiSdkSessionManager({ SessionManager }, runInput(), {});

    expect(SessionManager.inMemory).toHaveBeenCalledWith(process.cwd());
    expect(SessionManager.create).not.toHaveBeenCalled();
    expect(SessionManager.open).not.toHaveBeenCalled();
  });

  it("continues the newest session in a custom sessionDir without cwd filtering when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "openflow-pi-session-"));
    const sessionDir = join(root, "sessions");
    await mkdir(sessionDir, { recursive: true });
    const older = join(sessionDir, "2026-01-01_old.jsonl");
    const newer = join(sessionDir, "2026-01-02_new.jsonl");
    await writeFile(older, JSON.stringify({ type: "session", id: "old", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/old" }) + "\n");
    await writeFile(newer, JSON.stringify({ type: "session", id: "new", timestamp: "2026-01-02T00:00:00.000Z", cwd: "/different-cwd" }) + "\n");
    const now = new Date();
    await import("node:fs/promises").then((fs) => fs.utimes(older, now, new Date(now.getTime() - 10_000)));
    await import("node:fs/promises").then((fs) => fs.utimes(newer, now, now));
    const SessionManager = fakeSessionManager();

    createPiSdkSessionManager(
      { SessionManager },
      runInput({ cwd: "/current-run-workspace" }),
      { sessionPersistence: "continue-recent-any-cwd", sessionDir },
    );

    expect(SessionManager.open).toHaveBeenCalledWith(newer, sessionDir, "/current-run-workspace");
    expect(SessionManager.create).not.toHaveBeenCalled();
  });

  it("creates a persisted Pi session when no custom-dir session exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "openflow-pi-session-empty-"));
    const sessionDir = join(root, "sessions");
    const SessionManager = fakeSessionManager();

    createPiSdkSessionManager(
      { SessionManager },
      runInput({ cwd: "/workspace/run_1" }),
      { sessionPersistence: "continue-recent-any-cwd", sessionDir, sessionId: "sess_xiaobai" },
    );

    expect(SessionManager.create).toHaveBeenCalledWith("/workspace/run_1", sessionDir, { id: "sess_xiaobai" });
    expect(SessionManager.open).not.toHaveBeenCalled();
  });
});

function fakeSessionManager() {
  return {
    inMemory: vi.fn(() => ({ mode: "memory" })),
    create: vi.fn(() => ({ mode: "create" })),
    continueRecent: vi.fn(() => ({ mode: "continue" })),
    open: vi.fn(() => ({ mode: "open" })),
  };
}
