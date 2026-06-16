import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-08");

async function runCli(args: string[]) {
  const stdoutData: string[] = [];
  const stderrData: string[] = [];

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdoutData.push(chunk.toString());
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrData.push(chunk.toString());
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

  let error: any = null;
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Reporter modes", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Pretty reporter displays human progress", async () => {
    const workflowPath = path.join(TEMP_DIR, "tc-08.01.workflow.js");
    const configPath = path.join(TEMP_DIR, "tc-08.01.config.yaml");

    await fs.writeFile(workflowPath, `
export const meta = {
  name: "Pretty Progress",
  description: "Test for pretty reporter"
};

phase("init");
await agent({ id: "agent1", label: "Agent One", provider: "mock", prompt: "task 1" });

phase("process");
await agent({ id: "agent2", label: "Agent Two", provider: "mock", prompt: "task 2" });
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      agent1:
        text: "response 1"
      agent2:
        text: "response 2"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();

    // Assert: Four sections in order (Header, Execution, Summary, Artifacts)
    const headerIndex = result.stdout.indexOf("◇ Pretty Progress");
    const executionIndex = result.stdout.indexOf("Execution");
    const summaryIndex = result.stdout.indexOf("Summary");
    const artifactsIndex = result.stdout.indexOf("Artifacts");

    expect(headerIndex).toBeGreaterThan(-1);
    expect(executionIndex).toBeGreaterThan(headerIndex);
    expect(summaryIndex).toBeGreaterThan(executionIndex);
    expect(artifactsIndex).toBeGreaterThan(summaryIndex);

    // Assert: Exactly once for each main section
    expect(result.stdout.split("◇ Pretty Progress").length - 1).toBe(1);
    expect(result.stdout.split("Execution").length - 1).toBe(1);
    expect(result.stdout.split("Summary").length - 1).toBe(1);
    expect(result.stdout.split("Artifacts").length - 1).toBe(1);

    // Assert: Execution markers and spacing
    expect(result.stdout).toContain("→ init");
    expect(result.stdout).toContain("→ process");
    expect(result.stdout).toContain("✓ Agent One  mock");
    expect(result.stdout).toContain("✓ Agent Two  mock");

    // Assert: Summary
    expect(result.stdout).toContain("status:    succeeded");
    expect(result.stdout).toContain("workflows: 1 succeeded");
    expect(result.stdout).toContain("agents:    2 succeeded");

    // Assert: Artifacts (Success case shows only root dir)
    const artifactsSection = result.stdout.substring(artifactsIndex);
    expect(artifactsSection).toContain(TEMP_DIR);
    expect(artifactsSection).not.toContain("run:");
    expect(artifactsSection).not.toContain("failed:");
  });

  it("Pretty reporter displays failure artifact guidance", async () => {
    const workflowPath = path.join(TEMP_DIR, "failure.workflow.js");
    const configPath = path.join(TEMP_DIR, "failure.config.yaml");

    await fs.writeFile(workflowPath, `
export const meta = { name: "Failed Workflow", description: "intentional failure" };
await agent({ id: "failer", provider: "mock", prompt: "fail me" });
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      failer:
        exitCode: 1
        stderr: "intentional failure"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty",
      "--fail-fast"
    ]);
    // It should have an error because the workflow failed
    expect(result.error).not.toBeNull();

    expect(result.stdout).toContain("Failed Workflow");
    expect(result.stdout).toContain("Execution");
    expect(result.stdout).toContain("✕ failer");
    expect(result.stdout).toContain("Summary");
    expect(result.stdout).toContain("status:    failed");
    
    expect(result.stdout).toContain("Artifacts");
    expect(result.stdout).toContain("run:");
    expect(result.stdout).toContain("report:");
    expect(result.stdout).toContain("events:");
    expect(result.stdout).toContain("failed:");
    // Should show stderr.log or the agent directory
    expect(result.stdout).toMatch(/- agents\/failer/);
  });


  it("JSON reporter emits final JSON only to stdout", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();
    const stdout = result.stdout.trim();
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toContain("◇");
    expect(stdout).not.toContain("Artifacts");
  });

  it("JSONL reporter emits ordered event stream", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/reporter-modes.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report", "jsonl"
    ]);

    expect(result.error).toBeNull();
    const lines = result.stdout.split("\n").filter(l => l.trim());
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(result.stdout).not.toContain("◇");
  });

  it("Pretty reporter visibly marks dangerous write mode (AC-11)", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/dangerously-full-access-valid.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("⚠ full-access");
    expect(result.stdout).toContain("Artifacts");
  });
});
