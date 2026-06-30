import { describe, expect, it } from "vitest";
import { PiSdkAgentAdapter } from "../../../src/agents/pi-sdk-agent.js";

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
});
