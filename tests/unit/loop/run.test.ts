import { describe, expect, it, vi, beforeEach } from "vitest";
import { runLoop } from "../../../src/loop/run.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { withActiveWorkflowInvocation } from "../../../src/workflow/invocation-types.js";

describe("Loop Runner", () => {
  let mockRuntime: any;
  let mockEventSink: any;
  let mockArtifactStore: any;
  let mockDsl: any;

  beforeEach(() => {
    mockEventSink = { emit: vi.fn() };
    mockArtifactStore = {
      writeJson: vi.fn().mockResolvedValue("path"),
      appendJsonl: vi.fn().mockResolvedValue("path"),
      getRunArtifacts: vi.fn().mockReturnValue({ rootDir: "/tmp" }),
      isRunCreated: vi.fn().mockReturnValue(true),
    };
    mockDsl = {
      agent: vi.fn(),
      workflow: vi.fn(),
      parallel: vi.fn(),
      log: vi.fn(),
    };
    mockRuntime = {
      runId: "run-1",
      artifactsDir: "/tmp",
      eventSink: mockEventSink,
      artifactStore: mockArtifactStore,
      config: { workflow: { maxLoopRounds: 60 } },
      loopCounter: 0,
      loopSummaries: [],
      callSequence: 0,
      callCache: { readEnabled: false, writeIndex: false, currentEntries: [] },
    };
  });

  it("executes serial rounds until satisfied", async () => {
    const runRound = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ break: true, value: "final" });

    const result = await runLoop({
      initialState: { count: 0 },
      runRound,
      options: { maxRounds: 5 },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.status).toBe("satisfied");
    expect(result.accepted).toBe(true);
    expect(result.roundCount).toBe(2);
    expect(result.final).toBe("final");
    expect(runRound).toHaveBeenCalledTimes(2);
  });

  it("stops at maxRounds", async () => {
    const runRound = vi.fn().mockResolvedValue({ count: 1 });

    const result = await runLoop({
      initialState: { count: 0 },
      runRound,
      options: { maxRounds: 2 },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.status).toBe("max_rounds");
    expect(result.accepted).toBe(false);
    expect(result.roundCount).toBe(2);
  });

  it("evaluates stopWhen", async () => {
    const runRound = vi.fn().mockResolvedValue({ count: 1 });
    const stopWhen = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await runLoop({
      initialState: { count: 0 },
      runRound,
      options: { maxRounds: 5, stopWhen },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.status).toBe("satisfied");
    expect(result.roundCount).toBe(2);
    expect(stopWhen).toHaveBeenCalledTimes(2);
  });

  it("handles fail-fast failure mode", async () => {
    const runRound = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(runLoop({
      initialState: { count: 0 },
      runRound,
      options: { failureMode: "fail-fast" },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("boom");

    expect(mockRuntime.loopSummaries[0].status).toBe("failed");
  });

  it("handles settled failure mode", async () => {
    const runRound = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await runLoop({
      initialState: { count: 0 },
      runRound,
      options: { failureMode: "settled" },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.status).toBe("failed");
    expect(result.accepted).toBe(false);
    expect(result.error?.message).toBe("boom");
  });

  it("honors loop-level timeout", async () => {
    const runRound = () => new Promise(resolve => setTimeout(resolve, 100));

    const result = await runLoop({
      initialState: {},
      runRound,
      options: { timeoutMs: 10 },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.status).toBe("timed_out");
  });

  it("uses previous state by default when nextState is omitted", async () => {
    const runRound = vi.fn().mockImplementation((state) => {
      return { count: state.count + 1 }; // Return something different
    });

    const result = await runLoop({
      initialState: { count: 42 },
      runRound,
      options: { maxRounds: 3 },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.roundCount).toBe(3);
    // Every round should have received the same initial state { count: 42 }
    expect(runRound).toHaveBeenNthCalledWith(1, { count: 42 }, expect.anything());
    expect(runRound).toHaveBeenNthCalledWith(2, { count: 42 }, expect.anything());
    expect(runRound).toHaveBeenNthCalledWith(3, { count: 42 }, expect.anything());
    
    expect(result.finalState).toEqual({ count: 42 });
  });

  it("updates state when nextState is provided", async () => {
    const runRound = vi.fn().mockImplementation((state) => ({ val: state.val + 1 }));
    const nextState = vi.fn().mockImplementation(({ state, round }) => ({ val: state.val + round.result.val }));

    const result = await runLoop({
      initialState: { val: 10 },
      runRound,
      options: { maxRounds: 2, nextState },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    // Round 1: state {val:10}, result {val:11}. nextState => 10 + 11 = 21.
    // Round 2: state {val:21}, result {val:22}. nextState => not called if maxRounds reached
    expect(runRound).toHaveBeenNthCalledWith(1, { val: 10 }, expect.anything());
    expect(runRound).toHaveBeenNthCalledWith(2, { val: 21 }, expect.anything());
    expect(result.finalState).toEqual({ val: 21 });
  });

  it("passes current round history to stopWhen and nextState", async () => {
    const runRound = vi.fn().mockImplementation((state) => ({ count: state.count + 1 }));
    let historyInStopWhen: any[] = [];
    let historyInNextState: any[] = [];

    const stopWhen = vi.fn().mockImplementation(({ history }) => {
      historyInStopWhen = [...history];
      return history.length >= 2;
    });

    const nextState = vi.fn().mockImplementation(({ state, round, history }) => {
      historyInNextState = [...history];
      return { count: state.count + round.result.count };
    });

    await runLoop({
      initialState: { count: 0 },
      runRound,
      options: { maxRounds: 5, stopWhen, nextState },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    // Round 1:
    // historyInStopWhen should have 1 entry (round 1)
    // historyInNextState should have 1 entry (round 1)
    // Round 2:
    // historyInStopWhen should have 2 entries (round 1, round 2)
    // result stops here because stopWhen returns true

    expect(historyInStopWhen.length).toBe(2);
    expect(historyInStopWhen[0].index).toBe(1);
    expect(historyInStopWhen[1].index).toBe(2);
    expect(historyInStopWhen[1].result).toEqual({ count: 2 });
    
    // nextState was only called for Round 1
    expect(historyInNextState.length).toBe(1);
    expect(historyInNextState[0].index).toBe(1);
  });

  it("clears timeout and removes abort listener on normal completion", async () => {
    vi.useFakeTimers();
    const runRound = vi.fn().mockResolvedValue({ break: true });
    const signal = new AbortController().signal;
    const removeEventListenerSpy = vi.spyOn(signal, "removeEventListener");

    await runLoop({
      initialState: {},
      runRound,
      options: { timeoutMs: 1000 },
      runtime: mockRuntime,
      signal,
      dsl: mockDsl,
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    vi.useRealTimers();
  });

  it("does not accept break if timeout occurs during round execution", async () => {
    const runRound = () => new Promise(resolve => setTimeout(() => resolve({ break: true, value: "too-late" }), 100));
    const nextState = vi.fn().mockImplementation(({ state }) => state);
    const stopWhen = vi.fn().mockReturnValue(false);

    const result = await runLoop({
      initialState: {},
      runRound,
      options: { timeoutMs: 10, nextState, stopWhen },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result.status).toBe("timed_out");
    expect(result.accepted).toBe(false);
    expect(result.final).toBeUndefined();
    expect(nextState).not.toHaveBeenCalled();
    expect(stopWhen).not.toHaveBeenCalled();
  });

  it("propagates active workflow invocation ID to loop events", async () => {
    const runRound = vi.fn().mockResolvedValue({ break: true });
    const mockInvocation = {
      workflowInvocationId: "invocation-123",
      workflowName: "test-flow",
      depth: 0,
      startedAt: "2026-06-17T10:00:00Z",
    } as any;

    await withActiveWorkflowInvocation(mockInvocation, async () => {
      await runLoop({
        initialState: {},
        runRound,
        options: {},
        runtime: mockRuntime,
        signal: new AbortController().signal,
        dsl: mockDsl,
      });
    });

    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.started", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.round.started", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.round.completed", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.completed", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
  });
});
