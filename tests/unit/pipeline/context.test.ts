import { describe, expect, it } from "vitest";
import {
  getActivePipelineContext,
  withActivePipelineContext,
  recordChildAgentId,
  ActivePipelineContext
} from "../../../src/pipeline/context.js";

describe("pipeline context tracking", () => {
  it("stores and retrieves active pipeline context", () => {
    const ctx: ActivePipelineContext = {
      pipelineId: "pipeline-1",
      strategy: "item-streaming",
      itemIndex: 0,
      stageIndex: 0,
      stageName: "stage1",
      childAgentIds: []
    };

    expect(getActivePipelineContext()).toBeUndefined();

    withActivePipelineContext(ctx, () => {
      const active = getActivePipelineContext();
      expect(active).toBeDefined();
      expect(active?.pipelineId).toBe("pipeline-1");
      expect(active?.stageName).toBe("stage1");

      recordChildAgentId("agent-1");
      expect(active?.childAgentIds).toEqual(["agent-1"]);
    });

    expect(getActivePipelineContext()).toBeUndefined();
  });

  it("does not throw when recording child agent ID outside active context", () => {
    expect(() => recordChildAgentId("agent-1")).not.toThrow();
  });
});
