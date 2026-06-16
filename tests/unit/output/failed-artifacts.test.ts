import { describe, it, expect } from "vitest";
import { resolveFailedSubpaths } from "../../../src/output/failed-artifacts.js";
import type { PrettyFailureRecord } from "../../../src/output/pretty-view.js";

describe("resolveFailedSubpaths", () => {
  const rootDir = "/root/run";

  it("prefers validation-error.json for schema failures", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "agent",
        status: "failed",
        failureKind: "schema",
        artifactSubpath: "agents/agent-1",
        specificFailureSubpath: "agents/agent-1/validation-error.json"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result).toContain("agents/agent-1/validation-error.json");
    expect(result).toContain("agents/agent-1");
    // Priority order: specific first
    expect(result[0]).toBe("agents/agent-1/validation-error.json");
    expect(result[1]).toBe("agents/agent-1");
  });

  it("prefers stderr.log for provider/process failures", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "agent",
        status: "failed",
        failureKind: "provider",
        artifactSubpath: "agents/agent-1",
        specificFailureSubpath: "agents/agent-1/stderr.log"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result[0]).toBe("agents/agent-1/stderr.log");
    expect(result[1]).toBe("agents/agent-1");
  });

  it("prefers stderr.log for timeout failures", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "agent",
        status: "timed_out",
        failureKind: "timeout",
        artifactSubpath: "agents/agent-1",
        specificFailureSubpath: "agents/agent-1/stderr.log"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result[0]).toBe("agents/agent-1/stderr.log");
    expect(result[1]).toBe("agents/agent-1");
  });

  it("handles child workflow failures", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "workflow",
        status: "failed",
        artifactSubpath: "workflows/sub-1",
        specificFailureSubpath: "workflows/sub-1/error.json"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result[0]).toBe("workflows/sub-1/error.json");
    expect(result[1]).toBe("workflows/sub-1");
  });

  it("handles tool failures", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "tool",
        status: "failed",
        artifactSubpath: "tools/tool-1",
        specificFailureSubpath: "tools/tool-1/error.json"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result[0]).toBe("tools/tool-1/error.json");
    expect(result[1]).toBe("tools/tool-1");
  });

  it("deduplicates paths", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "agent",
        status: "failed",
        failureKind: "schema",
        artifactSubpath: "agents/agent-1",
        specificFailureSubpath: "agents/agent-1/validation-error.json"
      },
      {
        kind: "agent",
        status: "failed",
        failureKind: "schema",
        artifactSubpath: "agents/agent-1",
        specificFailureSubpath: "agents/agent-1/validation-error.json"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result).toHaveLength(2);
    expect(result).toEqual(["agents/agent-1/validation-error.json", "agents/agent-1"]);
  });

  it("ignores paths outside root", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "agent",
        status: "failed",
        artifactSubpath: "/other/path"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result).toHaveLength(0);
  });

  it("bounds output length", () => {
    const records: PrettyFailureRecord[] = [];
    for (let i = 0; i < 10; i++) {
      records.push({
        kind: "agent",
        status: "failed",
        artifactSubpath: `agents/agent-${i}`
      });
    }
    const result = resolveFailedSubpaths(rootDir, records, 3);
    expect(result).toHaveLength(4);
    expect(result[3]).toBe("... and 7 more");
  });

  it("converts absolute paths to relative", () => {
    const records: PrettyFailureRecord[] = [
      {
        kind: "agent",
        status: "failed",
        artifactSubpath: "/root/run/agents/agent-1"
      }
    ];
    const result = resolveFailedSubpaths(rootDir, records);
    expect(result[0]).toBe("agents/agent-1");
  });
});
