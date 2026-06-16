import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-reporters");

async function runCli(args: string[]) {
  const stdoutData: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdoutData.push(chunk.toString());
    return true;
  });
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    // Ignore
  } finally {
    stdoutSpy.mockRestore();
  }
  return stdoutData.join("");
}

describe("Nested Workflow Reporters", () => {
  let configPath: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    
    configPath = path.join(TEMP_DIR, "test-config.json");
    const testConfig = {
      workflow: {
        discovery: {
          include: ["tests/fixtures/workflows/nested/*.workflow.js"]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Pretty reporter shows nested workflow progress", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-basic.workflow.js";
    
    const stdout = await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty",
      "--arg", "message=pretty-test"
    ]);

    expect(stdout).toContain("Execution");
    expect(stdout).toContain("✓ workflow child-basic");
    expect(stdout).toContain("Summary");
    expect(stdout.split("Summary").length - 1).toBe(1);
    expect(stdout).toContain("status:    succeeded");
    expect(stdout).toContain("workflows: 2 succeeded");
  });

  it("Pretty reporter shows nested failures", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-settled-failure.workflow.js";
    
    const stdout = await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    expect(stdout).toContain("Execution");
    expect(stdout).toContain("✕ workflow child-failure");
    expect(stdout).toContain("Summary");
    expect(stdout).toContain("status:    succeeded");
    expect(stdout).toContain("workflows: 1 succeeded, 1 failed");
  });

  it("Pretty reporter shows root-level failures", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/child-failure.workflow.js";
    
    const stdout = await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    // Root workflow name is child-failure
    expect(stdout).toContain("◇ child-failure");
    expect(stdout).toContain("Execution");
    expect(stdout).toContain("Summary");
    expect(stdout).toContain("status:    failed");
    expect(stdout).toContain("workflows: 1 failed");
    expect(stdout).toContain("Artifacts");
    expect(stdout).toContain("failed:");
  });
});
