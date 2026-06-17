import { describe, expect, it } from "vitest";
import {
  createLoopId,
  createRoundId,
  createLoopAgentId
} from "../../../src/loop/id.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Loop ID Helpers", () => {
  describe("createLoopId", () => {
    it("generates correct loop ID for positive integers", () => {
      expect(createLoopId(1)).toBe("loop-1");
      expect(createLoopId(42)).toBe("loop-42");
    });

    it("throws on invalid sequence numbers", () => {
      expect(() => createLoopId(0)).toThrow(InvalidDslCallError);
      expect(() => createLoopId(-5)).toThrow(InvalidDslCallError);
      expect(() => createLoopId(NaN)).toThrow(InvalidDslCallError);
      expect(() => createLoopId("1" as any)).toThrow(InvalidDslCallError);
    });
  });

  describe("createRoundId", () => {
    it("generates correct round ID with padding", () => {
      expect(createRoundId("loop-1", 1)).toBe("loop-1-round-0001");
      expect(createRoundId("loop-5", 10)).toBe("loop-5-round-0010");
      expect(createRoundId("custom-loop", 9999)).toBe("custom-loop-round-9999");
    });

    it("throws on invalid inputs", () => {
      expect(() => createRoundId("", 1)).toThrow(InvalidDslCallError);
      expect(() => createRoundId(null as any, 1)).toThrow(InvalidDslCallError);
      expect(() => createRoundId("loop-1", 0)).toThrow(InvalidDslCallError);
      expect(() => createRoundId("loop-1", -1)).toThrow(InvalidDslCallError);
      expect(() => createRoundId("loop-1", NaN)).toThrow(InvalidDslCallError);
    });
  });

  describe("createLoopAgentId", () => {
    it("creates correct deterministic agent ID without suffix", () => {
      const id = createLoopAgentId({
        loopId: "loop-1",
        roundIndex: 1
      });
      expect(id).toBe("loop-1-round-0001");
    });

    it("creates correct deterministic agent ID with suffix", () => {
      const id = createLoopAgentId({
        loopId: "loop-2",
        roundIndex: 5,
        suffix: "reviewer"
      });
      expect(id).toBe("loop-2-round-0005-reviewer");
    });

    it("accepts valid suffixes", () => {
      const validSuffixes = ["agent-1", "review.v1", "task_3", "step:final"];
      for (const suffix of validSuffixes) {
        expect(() => createLoopAgentId({
          loopId: "loop-1",
          roundIndex: 1,
          suffix
        })).not.toThrow();
      }
    });

    it("throws on invalid suffixes", () => {
      const invalidSuffixes = [
        " ",
        "agent/1",
        "agent\\1",
        "..",
        ".",
        "nested/path",
        "with space",
        "unsafe$char"
      ];
      for (const suffix of invalidSuffixes) {
        expect(() => createLoopAgentId({
          loopId: "loop-1",
          roundIndex: 1,
          suffix
        })).toThrow(InvalidDslCallError);
      }
    });
  });
});
