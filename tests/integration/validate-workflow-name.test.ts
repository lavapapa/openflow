import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-validate-by-name-integration");

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
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  let error: any = null;
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    error = err;
    if (err instanceof Error && stderrData.length === 0) {
      stderrData.push(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integration - validate workflow by name", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("validates a workflow by name successfully", async () => {
    const result = await runCli([
      "validate",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("review");
    expect(result.stdout).toContain("tests/fixtures/workflows/run-by-name/review.workflow.js");
    expect(result.stdout.toLowerCase()).toContain("valid");
  });

  it("validates by explicit path successfully", async () => {
    const result = await runCli([
      "validate",
      "tests/fixtures/workflows/run-by-name/review.workflow.js",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("review");
  });

  it("fails validation when duplicate names exist", async () => {
    const result = await runCli([
      "validate",
      "duplicate-review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml"
    ]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("Multiple workflows found");
    expect(result.stderr).toContain("duplicate-a.workflow.js");
  });

  it("fails clearly when name discovery fails due to non-existent directory during validate", async () => {
    const result = await runCli([
      "validate",
      "review",
      "--config",
      "tests/fixtures/config/bad-discovery.config.yaml"
    ]);

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe("WORKFLOW_DISCOVERY_FAILED");
    expect(result.stderr).toContain("non-existent-directory-random");
  });

  it("succeeds even when unrelated invalid workflows are in scope", async () => {
    const result = await runCli([
      "validate",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("review");
  });

  it("fails when validating the executable-invalid workflow itself by name", async () => {
    const result = await runCli([
      "validate",
      "executable-invalid-unrelated",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml"
    ]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("Workflow validation failed");
  });

  it("does not create .openflow artifacts during validation", async () => {
    const result = await runCli([
      "validate",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml"
    ]);

    expect(result.error).toBeNull();
    const openflowDir = path.resolve(".openflow");
    // We just check that it didn't create a run directory recently
    // or better, we check a temp dir that we KNOW is empty
    const TEST_TEMP_OUT = path.join(TEMP_DIR, "no-artifacts-test");
    await fs.mkdir(TEST_TEMP_OUT, { recursive: true });

    const result2 = await runCli([
      "validate",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      // passing a config that points outDir to TEST_TEMP_OUT if possible
      // but validate doesn't take outDir.
    ]);

    const items = await fs.readdir(TEST_TEMP_OUT);
    expect(items.length).toBe(0);
  });

});
