import { describe, expect, it, vi } from "vitest";
import {
  stableHashJson,
  buildLoopStartReplayMarker,
  buildLoopRoundReplayMarker,
  recordLoopCacheMarker
} from "../../../src/loop/replay.js";

describe("Loop Replay and Cache Helpers", () => {
  describe("stableHashJson", () => {
    it("produces identical hashes for same data with different key order", () => {
      const h1 = stableHashJson({ a: 1, b: 2 });
      const h2 = stableHashJson({ b: 2, a: 1 });
      expect(h1).toBe(h2);
    });

    it("produces different hashes for different data", () => {
      const h1 = stableHashJson({ a: 1 });
      const h2 = stableHashJson({ a: 2 });
      expect(h1).not.toBe(h2);
    });
  });

  describe("buildLoopStartReplayMarker", () => {
    it("returns a deterministic hash", () => {
      const marker = buildLoopStartReplayMarker({
        loopId: "loop-1",
        optionsFingerprint: "opts-hash",
        initialStateHash: "state-hash",
        maxRounds: 5,
        maxRoundsCeiling: 60
      });
      expect(typeof marker).toBe("string");
      expect(marker.length).toBe(64); // sha256 hex
    });
  });

  describe("recordLoopCacheMarker", () => {
    const mockStore = {
      writeJson: vi.fn().mockResolvedValue("path"),
      appendJsonl: vi.fn().mockResolvedValue("path"),
      getRunArtifacts: vi.fn().mockReturnValue({ rootDir: "/tmp" }),
      isRunCreated: vi.fn().mockReturnValue(true),
    };

    it("detects cache hits", async () => {
      const cache = {
        readEnabled: true,
        prefixCacheUsable: true,
        previousEntries: new Map([[1, {
          kind: "loop",
          sequence: 1,
          callId: "loop-1",
          loopId: "loop-1",
          fingerprint: "match",
          status: "succeeded",
          resultPath: "loops/loop-1/loop.json"
        }]]),
        currentEntries: [],
        writeIndex: true
      };

      const hit = await recordLoopCacheMarker({
        store: mockStore as any,
        cache: cache as any,
        kind: "loop",
        sequence: 1,
        loopId: "loop-1",
        fingerprint: "match",
        resultPath: "loops/loop-1/loop.json"
      });

      expect(hit).toBeDefined();
      expect(hit?.loopId).toBe("loop-1");
      expect(cache.prefixCacheUsable).toBe(true);
    });

    it("detects cache misses and disables prefix cache", async () => {
      const cache = {
        readEnabled: true,
        prefixCacheUsable: true,
        previousEntries: new Map([[1, {
          kind: "loop",
          sequence: 1,
          callId: "loop-1",
          fingerprint: "old-hash",
          status: "succeeded",
          resultPath: "loops/loop-1/loop.json"
        }]]),
        currentEntries: [],
        writeIndex: true
      };

      const hit = await recordLoopCacheMarker({
        store: mockStore as any,
        cache: cache as any,
        kind: "loop",
        sequence: 1,
        loopId: "loop-1",
        fingerprint: "new-hash",
        resultPath: "loops/loop-1/loop.json"
      });

      expect(hit).toBeUndefined();
      expect(cache.prefixCacheUsable).toBe(false);
    });
  });
});
