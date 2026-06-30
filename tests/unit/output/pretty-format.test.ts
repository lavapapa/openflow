import { describe, it, expect } from "vitest";
import { formatDuration, getStatusMarker, formatPermission, formatStatusCounts } from "../../../src/output/pretty-format.js";

describe("Pretty Format Helpers", () => {
  describe("formatDuration", () => {
    it("formats seconds correctly", () => {
      expect(formatDuration(36700)).toBe("36.7s");
      expect(formatDuration(500)).toBe("0.5s");
    });

    it("formats minutes correctly", () => {
      expect(formatDuration(72300)).toBe("1m 12.3s");
    });

    it("formats hours correctly", () => {
      expect(formatDuration(3849200)).toBe("1h 04m 09.2s");
    });

    it("handles undefined/null", () => {
      expect(formatDuration(undefined)).toBe("");
    });
  });

  describe("getStatusMarker", () => {
    it("returns correct markers", () => {
      expect(getStatusMarker("succeeded")).toBe("✓");
      expect(getStatusMarker("failed")).toBe("✕");
      expect(getStatusMarker("timed_out")).toBe("⏱");
      expect(getStatusMarker("cancelled")).toBe("⏹");
      expect(getStatusMarker("running")).toBe("▶");
      expect(getStatusMarker("skipped")).toBe("-");
    });
  });

  describe("formatPermission", () => {
    it("formats dangerously-full-access", () => {
      expect(formatPermission("dangerously-full-access")).toBe("⚠ full-access");
    });

    it("leaves other modes unchanged", () => {
      expect(formatPermission("read-only")).toBe("read-only");
    });

    it("handles missing mode", () => {
      expect(formatPermission(undefined)).toBe("");
    });
  });

  describe("formatStatusCounts", () => {
    it("formats multiple statuses", () => {
      const counts = { succeeded: 4, failed: 1, timed_out: 0, cancelled: 0, skipped: 0, total: 5 };
      expect(formatStatusCounts(counts)).toBe("4 succeeded, 1 failed");
    });

    it("handles zero counts", () => {
      const counts = { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 };
      expect(formatStatusCounts(counts)).toBe("0");
    });
  });
});
