import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-list-run-consistency-integration");

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

  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  let error: any = null;
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integration - list to run consistency", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("can run a workflow name that is shown in the list command", async () => {
    const configPath = "tests/fixtures/config/run-by-name.config.yaml";
    
    // 1. List workflows
    const listResult = await runCli([
      "list",
      "workflows",
      "--config",
      configPath,
      "--report",
      "json"
    ]);

    expect(listResult.error).toBeNull();
    const listData = JSON.parse(listResult.stdout);
    const workflowNames = listData.resources.map((r: any) => r.name);
    
    expect(workflowNames).toContain("review");
    expect(workflowNames).toContain("Review"); // Case sensitive
    expect(workflowNames).toContain("explicit-path-test");

    // 2. Run the discovered 'review' workflow
    const runResult = await runCli([
      "run",
      "review",
      "--config",
      configPath,
      "--out",
      TEMP_DIR
    ]);

    expect(runResult.error).toBeNull();
    expect(runResult.stdout).toContain("◇ review");
  });
});
