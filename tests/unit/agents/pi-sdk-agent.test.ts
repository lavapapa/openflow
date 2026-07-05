import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPiSdkSessionManager,
  PiSdkAgentAdapter,
  usageFromPiSessionStatsDelta,
} from "../../../src/agents/pi-sdk-agent.js";

const piSdkMock = vi.hoisted(() => {
  const loaderOptions: any[] = [];
  const createAgentSession = vi.fn();
  const registerProvider = vi.fn();
  const sessionStats = [
    { tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 } },
    { tokens: { input: 20, output: 5, cacheRead: 1, cacheWrite: 0, total: 26 } },
  ];
  return {
    loaderOptions,
    createAgentSession,
    registerProvider,
    sessionStats,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  AuthStorage: {
    create: vi.fn(() => ({
      setRuntimeApiKey: vi.fn(),
    })),
  },
  createAgentSession: piSdkMock.createAgentSession,
  DefaultResourceLoader: class DefaultResourceLoader {
    constructor(options: any) {
      piSdkMock.loaderOptions.push(options);
    }

    async reload() {}
  },
  getAgentDir: () => "/tmp/pi-agent",
  ModelRegistry: {
    create: vi.fn(() => ({
      registerProvider: piSdkMock.registerProvider,
      find: vi.fn(() => ({ id: "deepseek-chat" })),
      hasConfiguredAuth: vi.fn(() => true),
    })),
  },
  SessionManager: {
    inMemory: vi.fn((cwd: string) => ({ cwd, isPersisted: () => false })),
    create: vi.fn((cwd: string, sessionDir?: string, options?: { id?: string }) => ({
      cwd,
      sessionDir,
      id: options?.id,
      isPersisted: () => Boolean(sessionDir),
      getSessionId: () => options?.id,
      getSessionDir: () => sessionDir,
    })),
    continueRecent: vi.fn((cwd: string, sessionDir?: string) => ({ cwd, sessionDir })),
    open: vi.fn((sessionFile: string, sessionDir: string | undefined, cwd: string) => ({
      cwd,
      sessionFile,
      sessionDir,
      isPersisted: () => true,
      getSessionFile: () => sessionFile,
      getSessionDir: () => sessionDir,
    })),
  },
  SettingsManager: {
    inMemory: vi.fn((settings: any) => settings),
  },
}));

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
  beforeEach(() => {
    piSdkMock.loaderOptions.length = 0;
    piSdkMock.registerProvider.mockClear();
    piSdkMock.createAgentSession.mockReset();
    piSdkMock.sessionStats.splice(
      0,
      piSdkMock.sessionStats.length,
      { tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 } },
      { tokens: { input: 20, output: 5, cacheRead: 1, cacheWrite: 0, total: 26 } },
    );
    piSdkMock.createAgentSession.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => undefined),
        subscribe: vi.fn(() => () => undefined),
        getLastAssistantText: vi.fn(() => "done"),
        getSessionStats: vi.fn(() => piSdkMock.sessionStats.shift()),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    });
  });

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

  it("passes noSkills and additional skill paths to the Pi SDK resource loader", async () => {
    const adapter = new PiSdkAgentAdapter({
      command: "pi-sdk",
      defaultModel: "deepseek-chat",
      piProvider: "deepseek",
      apiKey: "sk-runtime",
      baseUrl: "https://api.deepseek.com/v1",
      noSkills: true,
    });

    await expect(adapter.execute(
      runInput({ skills: ["input/skills/artifact-contract.md"] }),
      executionContext(),
    )).resolves.toMatchObject({
      parsed: {
        usage: {
          inputTokens: 10,
          cachedInputTokens: 1,
          outputTokens: 3,
          totalTokens: 14,
        },
      },
    });

    expect(piSdkMock.loaderOptions[0]).toMatchObject({
      additionalSkillPaths: ["input/skills/artifact-contract.md"],
      noSkills: true,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
    });
  });

  it("allows hosts to opt back into default Pi skills explicitly", async () => {
    const adapter = new PiSdkAgentAdapter({
      command: "pi-sdk",
      defaultModel: "deepseek-chat",
      piProvider: "deepseek",
      apiKey: "sk-runtime",
      noSkills: false,
    });

    await adapter.execute(runInput(), executionContext());

    expect(piSdkMock.loaderOptions[0]).toMatchObject({
      noSkills: false,
    });
  });

  it("normalizes real Pi SDK session usage as a per-call delta", () => {
    expect(
      usageFromPiSessionStatsDelta(
        { tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1, total: 126 } },
        { tokens: { input: 160, output: 45, cacheRead: 8, cacheWrite: 3, total: 216 } },
      ),
    ).toEqual({
      inputTokens: 60,
      cachedInputTokens: 5,
      outputTokens: 25,
      totalTokens: 90,
    });
    expect(
      usageFromPiSessionStatsDelta(
        { tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1, total: 126 } },
        { tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1, total: 126 } },
      ),
    ).toBeUndefined();
  });

  it("normalizes alternate Pi SDK usage shapes without losing token categories", () => {
    expect(
      usageFromPiSessionStatsDelta(
        {
          usage: {
            promptTokens: 100,
            completionTokens: 20,
            cachedInputTokens: 5,
            reasoningOutputTokens: 3,
            totalTokens: 128,
          },
        },
        {
          usage: {
            promptTokens: 140,
            completionTokens: 35,
            cachedInputTokens: 8,
            reasoningOutputTokens: 4,
            totalTokens: 187,
          },
        },
      ),
    ).toEqual({
      inputTokens: 40,
      cachedInputTokens: 3,
      outputTokens: 15,
      reasoningOutputTokens: 1,
      totalTokens: 59,
    });
  });

  it("preserves Pi SDK reported total token delta when it differs from component math", () => {
    expect(
      usageFromPiSessionStatsDelta(
        { tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 } },
        { tokens: { input: 20, output: 9, cacheRead: 1, cacheWrite: 0, total: 35 } },
      ),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 1,
      outputTokens: 4,
      totalTokens: 20,
    });
  });

  it("reports total-only Pi SDK stats as total-only instead of inventing categories", () => {
    expect(
      usageFromPiSessionStatsDelta(
        { tokens: { total: 100 } },
        { tokens: { total: 140 } },
      ),
    ).toEqual({
      totalTokens: 40,
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

function executionContext() {
  return {
    signal: new AbortController().signal,
    emitOutput: vi.fn(async () => undefined),
  } as any;
}
