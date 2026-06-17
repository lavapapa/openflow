import { describe, expect, it, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { runLoop } from "../../../src/loop/run.js";

vi.mock("../../../src/loop/run.js", () => ({
  runLoop: vi.fn()
}));

describe("DSL loop()", () => {
  it("calls runLoop with correct arguments", async () => {
    const runtime = {
      agentCounter: 0,
      agentResults: [],
      toolResults: [],
      abortController: new AbortController(),
      config: { workflow: { maxLoopRounds: 60 } },
      eventSink: { emit: vi.fn() }
    } as any;

    const dsl = createDsl(runtime);
    const initialState = { count: 0 };
    const runRound = (state: any) => state;
    const options = { maxRounds: 5 };

    await dsl.loop(initialState, runRound, options);

    expect(runLoop).toHaveBeenCalledWith(expect.objectContaining({
      initialState,
      runRound,
      options,
      runtime,
      dsl: expect.objectContaining({
        agent: expect.any(Function),
        workflow: expect.any(Function),
        parallel: expect.any(Function),
        log: expect.any(Function)
      })
    }));
  });
});
