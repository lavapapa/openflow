import { describe, expect, it } from "vitest";
import { buildPipelineSummary } from "../../../src/pipeline/summary.js";
import type { PipelineItemResult } from "../../../src/pipeline/types.js";

describe("Pipeline Summary Builder", () => {
  const mockResults: PipelineItemResult[] = [
    {
      itemIndex: 0,
      status: "succeeded",
      startedAt: "start",
      finishedAt: "finish",
      durationMs: 100,
      value: "out",
      stages: []
    },
    {
      itemIndex: 1,
      status: "failed",
      startedAt: "start",
      finishedAt: "finish",
      durationMs: 150,
      stages: []
    },
    {
      itemIndex: 2,
      status: "cancelled",
      startedAt: "start",
      finishedAt: "finish",
      durationMs: 50,
      stages: []
    }
  ];

  it("buildPipelineSummary counts succeeded, failed, cancelled, and skipped items correctly", () => {
    const summary = buildPipelineSummary({
      pipelineId: "pipeline-1",
      label: "my-label",
      strategy: "stage-barrier",
      status: "failed",
      itemCount: 5,
      results: mockResults,
      stageNames: ["lint", "test"],
      durationMs: 300,
      artifactsDir: "/mock-artifacts"
    });

    expect(summary.pipelineId).toBe("pipeline-1");
    expect(summary.label).toBe("my-label");
    expect(summary.strategy).toBe("stage-barrier");
    expect(summary.status).toBe("failed");
    expect(summary.itemCount).toBe(5);
    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.skippedCount).toBe(2);
    expect(summary.stageNames).toEqual(["lint", "test"]);
    expect(summary.durationMs).toBe(300);
    expect(summary.artifactPath).toBe("/mock-artifacts/pipelines/pipeline-1/pipeline.json");
  });
});
