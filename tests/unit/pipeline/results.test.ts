import { describe, expect, it } from "vitest";
import {
  getIsoTimestamp,
  getDurationMs,
  createSucceededStageResult,
  createFailedStageResult,
  createSkippedStageResult,
  createItemSuccess,
  createItemFailure,
  appendSkippedStages
} from "../../../src/pipeline/results.js";

describe("pipeline results helpers", () => {
  it("computes duration and timestamps correctly", () => {
    const start = "2026-06-02T20:00:00.000Z";
    const end = "2026-06-02T20:00:05.500Z";
    expect(getDurationMs(start, end)).toBe(5500);
    expect(getIsoTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("creates succeeded stage result", () => {
    const res = createSucceededStageResult("stage-1", 0, "start", "end", 100, { foo: "bar" }, ["agent-1"]);
    expect(res).toEqual({
      stageName: "stage-1",
      stageIndex: 0,
      status: "succeeded",
      startedAt: "start",
      finishedAt: "end",
      durationMs: 100,
      value: { foo: "bar" },
      childAgentIds: ["agent-1"]
    });
  });

  it("creates failed stage result", () => {
    const err = { name: "Error", message: "fail", code: "err" };
    const res = createFailedStageResult("stage-1", 0, "failed", "start", "end", 100, err, ["agent-1"]);
    expect(res).toEqual({
      stageName: "stage-1",
      stageIndex: 0,
      status: "failed",
      startedAt: "start",
      finishedAt: "end",
      durationMs: 100,
      error: err,
      childAgentIds: ["agent-1"]
    });
  });

  it("creates skipped stage result", () => {
    const res = createSkippedStageResult("stage-2", 1, "timestamp");
    expect(res).toEqual({
      stageName: "stage-2",
      stageIndex: 1,
      status: "skipped",
      startedAt: "timestamp",
      finishedAt: "timestamp",
      durationMs: 0,
      childAgentIds: []
    });
  });

  it("creates item success", () => {
    const stages = [createSucceededStageResult("s1", 0, "s", "e", 10, "val", [])];
    const res = createItemSuccess(0, "s", "e", 10, "val", stages);
    expect(res).toEqual({
      itemIndex: 0,
      status: "succeeded",
      startedAt: "s",
      finishedAt: "e",
      durationMs: 10,
      value: "val",
      stages
    });
  });

  it("creates item failure", () => {
    const stages = [createSkippedStageResult("s1", 0, "t")];
    const err = { name: "Error", message: "fail" };
    const res = createItemFailure(0, "failed", "s", "e", 10, "s1", err, stages);
    expect(res).toEqual({
      itemIndex: 0,
      status: "failed",
      startedAt: "s",
      finishedAt: "e",
      durationMs: 10,
      failedStage: "s1",
      error: err,
      stages
    });
  });

  it("appends skipped stages correctly", () => {
    const stages = [{ name: "s1", run: () => {} }, { name: "s2", run: () => {} }];
    const appended = appendSkippedStages([], stages, -1, "timestamp");
    expect(appended).toHaveLength(2);
    expect(appended[0]?.status).toBe("skipped");
    expect(appended[1]?.status).toBe("skipped");
  });
});
