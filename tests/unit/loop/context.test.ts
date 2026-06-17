import { describe, expect, it, vi } from "vitest";
import { createLoopRoundContext, withActiveLoopContext, getActiveLoopContext, recordLoopChildAgentId } from "../../../src/loop/context.js";

describe("Loop Context Helpers", () => {
  const mockDsl = {
    agent: vi.fn(),
    workflow: vi.fn(),
    parallel: vi.fn(),
    log: vi.fn(),
  };

  const input = {
    loopId: "loop-1",
    runId: "run-1",
    artifactsDir: "/tmp",
    roundIndex: 1,
    roundId: "loop-1-round-0001",
    maxRounds: 5,
    signal: new AbortController().signal,
    dsl: mockDsl as any,
  };

  describe("createLoopRoundContext", () => {
    it("exposes required properties", () => {
      const ctx = createLoopRoundContext(input);
      expect(ctx.loopId).toBe("loop-1");
      expect(ctx.roundIndex).toBe(1);
      expect(ctx.roundId).toBe("loop-1-round-0001");
    });

    it("ctx.agent preserves explicit agent IDs and records them", async () => {
      const ctx = createLoopRoundContext(input);
      const activeCtx = { loopId: "loop-1", roundIndex: 1, roundId: "round-1", childAgentIds: [] };
      
      await withActiveLoopContext(activeCtx, async () => {
        await ctx.agent({ prompt: "hi", id: "my-agent" });
      });

      expect(mockDsl.agent).toHaveBeenCalledWith(expect.objectContaining({
        id: "my-agent"
      }));
      expect(activeCtx.childAgentIds).toContain("my-agent");
    });

    it("ctx.agent generates loop-scoped IDs from label or counter when ID is absent", async () => {
      const ctx = createLoopRoundContext(input);
      const activeCtx = { loopId: "loop-1", roundIndex: 1, roundId: "round-1", childAgentIds: [] };
      
      await withActiveLoopContext(activeCtx, async () => {
        await ctx.agent({ prompt: "hi", label: "review" });
        await ctx.agent({ prompt: "hello" });
        await ctx.agent({ prompt: "invalid label", label: "some label with spaces" });
      });

      expect(mockDsl.agent).toHaveBeenNthCalledWith(2, expect.objectContaining({
        id: "loop-1-round-0001-review"
      }));
      expect(mockDsl.agent).toHaveBeenNthCalledWith(3, expect.objectContaining({
        id: "loop-1-round-0001-agent-2"
      }));
      expect(mockDsl.agent).toHaveBeenNthCalledWith(4, expect.objectContaining({
        id: "loop-1-round-0001-agent-3"
      }));

      expect(activeCtx.childAgentIds).toContain("loop-1-round-0001-review");
      expect(activeCtx.childAgentIds).toContain("loop-1-round-0001-agent-2");
      expect(activeCtx.childAgentIds).toContain("loop-1-round-0001-agent-3");
    });

    it("ctx.agent preserves IDs returned by ctx.agentId()", async () => {
      const ctx = createLoopRoundContext(input);
      const activeCtx = { loopId: "loop-1", roundIndex: 1, roundId: "round-1", childAgentIds: [] };
      
      await withActiveLoopContext(activeCtx, async () => {
        await ctx.agent({ prompt: "hi", id: ctx.agentId("custom-name") });
      });

      expect(mockDsl.agent).toHaveBeenNthCalledWith(5, expect.objectContaining({
        id: "loop-1-round-0001-custom-name"
      }));
      expect(activeCtx.childAgentIds).toContain("loop-1-round-0001-custom-name");
    });

    it("ctx.log includes loop metadata", () => {
      const ctx = createLoopRoundContext(input);
      ctx.log("hello", { foo: "bar" });
      expect(mockDsl.log).toHaveBeenCalledWith("hello", expect.objectContaining({
        foo: "bar",
        loop: {
          loopId: "loop-1",
          roundIndex: 1,
          roundId: "loop-1-round-0001"
        }
      }));
    });

    it("ctx.break returns a branded LoopBreak", () => {
      const ctx = createLoopRoundContext(input);
      const b = ctx.break("final", { reason: "done" });
      expect(b).toEqual({
        __brand: "loop-break",
        value: "final",
        reason: "done"
      });
    });

    it("ctx.sleep removes abort listener after resolving", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const ctx = createLoopRoundContext({ ...input, signal });
      
      const addEventListenerSpy = vi.spyOn(signal, "addEventListener");
      const removeEventListenerSpy = vi.spyOn(signal, "removeEventListener");

      await ctx.sleep(10);

      expect(addEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("ctx.sleep removes abort listener after rejection", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const ctx = createLoopRoundContext({ ...input, signal });
      
      const removeEventListenerSpy = vi.spyOn(signal, "removeEventListener");

      const promise = ctx.sleep(100);
      controller.abort("manual abort");

      await expect(promise).rejects.toBe("manual abort");
      expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });

  describe("ActiveLoopContext Storage", () => {
    it("manages context in AsyncLocalStorage", () => {
      const activeCtx = { loopId: "loop-1", roundIndex: 1, roundId: "round-1", childAgentIds: [] };
      withActiveLoopContext(activeCtx, () => {
        expect(getActiveLoopContext()).toBe(activeCtx);
        recordLoopChildAgentId("agent-1");
        expect(activeCtx.childAgentIds).toContain("agent-1");
      });
      expect(getActiveLoopContext()).toBeUndefined();
    });
  });
});
