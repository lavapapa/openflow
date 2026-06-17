import { describe, expect, it } from "vitest";
import {
  getIsoTimestamp,
  getDurationMs,
  createHistoryEntry,
  createRoundView,
  isLoopBreak,
  isPlainBreakObject,
  normalizeBreakReturn,
  buildLoopResult
} from "../../../src/loop/results.js";

describe("Loop Result Helpers", () => {
  describe("isLoopBreak", () => {
    it("identifies branded loop breaks", () => {
      expect(isLoopBreak({ __brand: "loop-break" })).toBe(true);
      expect(isLoopBreak({ __brand: "loop-break", value: 42 })).toBe(true);
      expect(isLoopBreak({ break: true })).toBe(false);
      expect(isLoopBreak(null)).toBe(false);
      expect(isLoopBreak({})).toBe(false);
    });
  });

  describe("isPlainBreakObject", () => {
    it("identifies plain break objects", () => {
      expect(isPlainBreakObject({ break: true })).toBe(true);
      expect(isPlainBreakObject({ break: true, value: "done" })).toBe(true);
      expect(isPlainBreakObject({ break: false })).toBe(false);
      expect(isPlainBreakObject({ __brand: "loop-break" })).toBe(false);
      expect(isPlainBreakObject(null)).toBe(false);
    });
  });

  describe("normalizeBreakReturn", () => {
    it("normalizes branded breaks", () => {
      const result = normalizeBreakReturn({ __brand: "loop-break", value: "final", reason: "satisfied" } as any);
      expect(result.isBreak).toBe(true);
      expect(result.finalValue).toBe("final");
      expect(result.reason).toBe("satisfied");
    });

    it("normalizes plain break objects", () => {
      const result = normalizeBreakReturn({ break: true, value: "final", state: { x: 1 } } as any);
      expect(result.isBreak).toBe(true);
      expect(result.finalValue).toBe("final");
      expect(result.finalState).toEqual({ x: 1 });
    });

    it("normalizes normal results", () => {
      const result = normalizeBreakReturn({ some: "data" } as any);
      expect(result.isBreak).toBe(false);
      expect(result.roundResult).toEqual({ some: "data" });
    });
  });

  describe("createHistoryEntry", () => {
    it("creates a concise entry", () => {
      const entry = createHistoryEntry({
        index: 1,
        status: "completed",
        break: false,
        durationMs: 120
      });
      expect(entry).toEqual({
        index: 1,
        status: "completed",
        break: false,
        durationMs: 120
      });
    });

    it("includes optional fields", () => {
      const entry = createHistoryEntry({
        index: 2,
        status: "completed",
        break: true,
        stopMatched: true,
        reason: "matched",
        durationMs: 50,
        artifactPath: "path/to/artifact"
      });
      expect(entry.stopMatched).toBe(true);
      expect(entry.reason).toBe("matched");
      expect(entry.artifactPath).toBe("path/to/artifact");
    });
  });

  describe("buildLoopResult", () => {
    it("builds a complete LoopResult", () => {
      const result = buildLoopResult({
        loopId: "loop-1",
        status: "satisfied",
        accepted: true,
        roundCount: 2,
        maxRounds: 5,
        finalState: { done: true },
        final: "result",
        reason: "accepted",
        history: [],
        startedAt: "2026-06-17T10:00:00Z",
        finishedAt: "2026-06-17T10:00:05Z",
        durationMs: 5000,
        artifactPath: "loops/loop-1"
      });
      expect(result.schemaVersion).toBe("open-dynamic-workflow.loop-result.v1");
      expect(result.loopId).toBe("loop-1");
      expect(result.status).toBe("satisfied");
      expect(result.finalState).toEqual({ done: true });
      expect(result.final).toBe("result");
      expect(result.reason).toBe("accepted");
    });
  });
});
