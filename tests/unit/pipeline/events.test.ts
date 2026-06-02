import { describe, expect, it } from "vitest";
import {
  buildPipelineStartedPayload,
  buildPipelineTerminalPayload,
  buildPipelineItemStartedPayload,
  buildPipelineItemTerminalPayload,
  buildPipelineStageStartedPayload,
  buildPipelineStageTerminalPayload,
  compactStageResult,
  compactItemResult
} from "../../../src/pipeline/events.js";
import type { PipelineItemResult, PipelineStageResult } from "../../../src/pipeline/types.js";

describe("Pipeline Event Payload Builders", () => {
  const mockStageResult: PipelineStageResult = {
    stageName: "lint",
    stageIndex: 0,
    status: "succeeded",
    startedAt: "2026-06-02T00:00:00.000Z",
    finishedAt: "2026-06-02T00:00:00.100Z",
    durationMs: 100,
    value: { ok: true },
    childAgentIds: ["agent-1"]
  };

  const mockItemResult: PipelineItemResult = {
    itemIndex: 0,
    status: "succeeded",
    startedAt: "2026-06-02T00:00:00.000Z",
    finishedAt: "2026-06-02T00:00:00.200Z",
    durationMs: 200,
    value: "final-output",
    stages: [mockStageResult]
  };

  it("compactStageResult strips value but keeps childAgentIds and error status", () => {
    const compacted = compactStageResult(mockStageResult);
    expect(compacted.stageName).toBe("lint");
    expect(compacted.status).toBe("succeeded");
    expect(compacted.childAgentIds).toEqual(["agent-1"]);
    expect((compacted as any).value).toBeUndefined();
  });

  it("compactItemResult strips value and keeps stages compacted", () => {
    const compacted = compactItemResult(mockItemResult);
    expect(compacted.itemIndex).toBe(0);
    expect(compacted.status).toBe("succeeded");
    expect(compacted.stages[0]?.stageName).toBe("lint");
    expect((compacted as any).value).toBeUndefined();
  });

  it("buildPipelineStartedPayload formats start details correctly", () => {
    const payload = buildPipelineStartedPayload(
      "pipeline-1",
      [1, 2, 3],
      [{ name: "lint", run: () => {} }],
      { strategy: "item-streaming", stageConcurrency: {}, preserveOrder: true, failFast: false, label: "test" }
    );
    expect(payload.pipelineId).toBe("pipeline-1");
    expect(payload.itemCount).toBe(3);
    expect(payload.stages).toEqual(["lint"]);
    expect(payload.strategy).toBe("item-streaming");
    expect(payload.label).toBe("test");
  });

  it("buildPipelineTerminalPayload constructs compacted payload", () => {
    const payload = buildPipelineTerminalPayload(
      "pipeline-1",
      "succeeded",
      1500,
      [mockItemResult],
      "path/to/pipeline.json"
    );
    expect(payload.pipelineId).toBe("pipeline-1");
    expect(payload.status).toBe("succeeded");
    expect(payload.durationMs).toBe(1500);
    expect(payload.results.length).toBe(1);
    expect(payload.results[0]?.itemIndex).toBe(0);
    expect(payload.artifactPath).toBe("path/to/pipeline.json");
  });

  it("buildPipelineItemStartedPayload constructs item start details", () => {
    const payload = buildPipelineItemStartedPayload("pipeline-1", 4, "timestamp");
    expect(payload.pipelineId).toBe("pipeline-1");
    expect(payload.itemIndex).toBe(4);
    expect(payload.startedAt).toBe("timestamp");
  });

  it("buildPipelineItemTerminalPayload constructs item terminal payload", () => {
    const payload = buildPipelineItemTerminalPayload("pipeline-1", mockItemResult);
    expect(payload.pipelineId).toBe("pipeline-1");
    expect(payload.itemIndex).toBe(0);
    expect(payload.status).toBe("succeeded");
    expect(payload.stages.length).toBe(1);
  });

  it("buildPipelineStageStartedPayload constructs stage start details", () => {
    const payload = buildPipelineStageStartedPayload("pipeline-1", 1, "test-stage", 2, "timestamp");
    expect(payload.pipelineId).toBe("pipeline-1");
    expect(payload.itemIndex).toBe(1);
    expect(payload.stageName).toBe("test-stage");
    expect(payload.stageIndex).toBe(2);
    expect(payload.startedAt).toBe("timestamp");
  });

  it("buildPipelineStageTerminalPayload constructs stage terminal payload", () => {
    const payload = buildPipelineStageTerminalPayload("pipeline-1", 1, mockStageResult);
    expect(payload.pipelineId).toBe("pipeline-1");
    expect(payload.itemIndex).toBe(1);
    expect(payload.stageName).toBe("lint");
    expect(payload.status).toBe("succeeded");
  });
});
