import { describe, expect, it } from "vitest";
import {
  buildSucceededRunResult,
  buildFailedRunResult,
  buildCancelledRunResult
} from "../../../src/workflow/runtime.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig } from "../../../src/types/config.js";
import type { LoopSummary } from "../../../src/loop/types.js";

function makeRuntimeStateWithLoops(loopSummaries: LoopSummary[] = []): RuntimeState {
  const parsedWorkflow: ParsedWorkflow = {
    meta: { name: "test-workflow", description: "Test description" },
    body: "",
    sourcePath: "workflow.js",
    sourceText: "",
    sourceHash: "abc123"
  };

  const config: ResolvedConfig = {
    defaultProvider: "mock",
    concurrency: 2,
    timeoutMs: 30000,
    providers: {},
    security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
    reporting: { mode: "pretty", verbose: false },
    cwd: "/workspace",
    outDir: "/workspace/.open-dynamic-workflow/runs",
    cliArgs: {}
  } as any;

  return {
    runId: "run-result-test",
    parsedWorkflow,
    config,
    args: {},
    cwd: "/workspace",
    artifactsDir: "/workspace/.open-dynamic-workflow/runs/run-result-test",
    agentResults: [],
    toolResults: [],
    scheduler: {} as any,
    agentExecutor: {} as any,
    eventSink: {} as any,
    abortController: new AbortController(),
    agentCounter: 0,
    loopSummaries,
    startedAt: "2026-06-02T00:00:00.000Z"
  } as any;
}

describe("Workflow Run Result with Loops", () => {
  const loopSummaries: LoopSummary[] = [
    { label: "loop1", rounds: 3, status: "succeeded", durationMs: 150 },
    { label: "loop2", rounds: 5, status: "failed", error: "boom", durationMs: 200 }
  ];

  it("buildSucceededRunResult includes loops", () => {
    const runtime = makeRuntimeStateWithLoops(loopSummaries);
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");
    expect(result.loops).toEqual(loopSummaries);
  });

  it("buildFailedRunResult includes loops", () => {
    const runtime = makeRuntimeStateWithLoops(loopSummaries);
    const result = buildFailedRunResult(runtime, new Error("fail"), 100, "2026-06-02T00:00:01.000Z");
    expect(result.loops).toEqual(loopSummaries);
  });

  it("buildCancelledRunResult includes loops", () => {
    const runtime = makeRuntimeStateWithLoops(loopSummaries);
    const result = buildCancelledRunResult(runtime, 100, "2026-06-02T00:00:01.000Z", "cancelled");
    expect(result.loops).toEqual(loopSummaries);
  });
});
