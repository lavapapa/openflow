import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-loop-acceptance-aaa");

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
  let exitCode: number | undefined;

  // Mock process.exit
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`Process.exit(${code})`);
  });

  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err: any) {
    if (err.message.startsWith("Process.exit")) {
      // expected from mock
    } else {
      error = err;
      exitCode = exitCodeForError(err);
      console.error(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  if (exitCode === undefined) {
    exitCode = 0;
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error,
    exitCode
  };
}

describe("Loop Acceptance (AAA)", () => {
  const configPath = path.resolve("tests/fixtures/config/loop-integration.config.yaml");

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("verifies serial state progression and explicit ctx.break", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    
    expect(parsed.loops).toBeDefined();
    expect(parsed.loops[0].status).toBe("satisfied");
    expect(parsed.loops[0].roundCount).toBe(2);
    expect(parsed.loops[0].accepted).toBe(true);

    // Check artifacts
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]);
    const loopDir = path.join(runDir, "loops", "loop-1");
    
    const history = JSON.parse(await fs.readFile(path.join(loopDir, "history.json"), "utf8"));
    expect(history.length).toBe(2);
    expect(history[0].state).toEqual({ count: 0 });
    expect(history[1].break).toBe(true);

    const loopMeta = JSON.parse(await fs.readFile(path.join(loopDir, "loop.json"), "utf8"));
    expect(loopMeta.options.maxRounds).toBe(5);
    
    const resultJson = JSON.parse(await fs.readFile(path.join(loopDir, "result.json"), "utf8"));
    expect(resultJson.status).toBe("satisfied");
  });

  it("verifies { break: true } return form", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-return-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.loops[0].status).toBe("satisfied");
    expect(parsed.loops[0].roundCount).toBe(2);
    expect(parsed.loops[0].accepted).toBe(true);
  });

  it("verifies stopWhen history evaluation", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-stop-when.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.loops[0].status).toBe("satisfied");
    expect(parsed.loops[0].roundCount).toBe(4);
  });

  it("verifies maxRounds terminal behavior", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-max-rounds.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.loops[0].status).toBe("max_rounds");
    expect(parsed.loops[0].roundCount).toBe(2);
    expect(parsed.loops[0].accepted).toBe(false);
  });

  it("verifies failureMode: fail-fast (default)", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-failure-fail-fast.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    // Workflow should fail overall in fail-fast mode
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.loops[0].status).toBe("failed");
    expect(parsed.loops[0].roundCount).toBe(1);
  });

  it("verifies failureMode: settled", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-failure-settled.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded"); // Workflow succeeds because failure is settled
    expect(parsed.loops[0].status).toBe("failed");
    expect(parsed.loops[0].roundCount).toBe(1);
  });

  it("verifies forbidden tool() usage inside loop", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-tool.js");

    // Act
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("tool() is not allowed");
  });

  it("verifies forbidden maxRounds exceeds ceiling validation", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-max-rounds.workflow.js");

    // Act
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("maxRounds");
    expect(result.stderr).toContain("exceeds the configured ceiling of 60");
  });

  it("verifies allowed ctx.agent(), ctx.workflow(), and ctx.parallel()", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-parallel.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    
    // Verify nested artifacts
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]);
    const roundDir = path.join(runDir, "loops/loop-1/rounds/0001");
    expect(await fs.stat(path.join(roundDir, "round.json"))).toBeDefined();
  });

  it("verifies nested workflow() call is allowed", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-workflow.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
  });

  it("verifies loop artifacts are correctly written", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR
    ]);

    // Assert
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]);
    const loopDir = path.join(runDir, "loops", "loop-1");
    
    expect(await fs.stat(path.join(loopDir, "loop.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "history.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/round.json"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "agents/loop-1-round-0001-agent-1/raw-result.json"))).toBeDefined();
  });

  it("verifies compact event payloads in JSONL", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ]);

    // Assert
    const lines = result.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    
    const loopStarted = events.find(e => e.type === "loop.started");
    expect(loopStarted.payload.loopId).toBe("loop-1");

    const roundCompleted = events.find(e => e.type === "loop.round.completed");
    expect(roundCompleted.payload.roundIndex).toBe(1);
    expect(roundCompleted.payload.historyEntry).toBeUndefined();
  });

  it("verifies pretty report correctly summarizes loop execution", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    // Assert
    expect(result.stdout).toContain("loop loop-1");
    expect(result.stdout).toContain("2/5 rounds");
    expect(result.stdout).toContain("accepted");
    expect(result.stdout).toContain("loops:     1 succeeded");
  });

  it("verifies loop resume with cache hits", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-resume-cache.workflow.js");

    // Act
    // First run to populate cache
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);
    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;

    // Second run (resume from first)
    const result2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);

    // Assert
    expect(result2.error).toBeNull();
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    
    // Check for agent cache hits inside loop rounds
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits.length).toBeGreaterThan(0);
  });

  it("verifies existing non-loop workflows continue to function normally", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/valid-basic.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.loops).toEqual([]);
  });
});
