import { describe, expect, it, vi } from "vitest";
import {
  buildAgentArtifactReferences,
  writeStageArtifact,
  writeItemArtifact,
  writePipelineArtifact
} from "../../../src/pipeline/artifacts.js";
import type { ArtifactStore } from "../../../src/types/artifacts.js";
import type { PipelineItemResult, PipelineStageResult } from "../../../src/pipeline/types.js";

describe("Pipeline Artifacts Helper", () => {
  const createMockArtifactStore = () => {
    const writes: Record<string, unknown> = {};
    const store: Partial<ArtifactStore> = {
      writeJson: vi.fn(async (relativePath: string, value: unknown) => {
        writes[relativePath] = value;
        return `/mock-root/${relativePath}`;
      })
    };
    return {
      store: store as ArtifactStore,
      writes,
      writeJson: store.writeJson
    };
  };

  it("buildAgentArtifactReferences generates correct paths", () => {
    const refs = buildAgentArtifactReferences("agent/1");
    expect(refs.dir).toBe("agents/agent_1");
    expect(refs.promptPath).toBe("agents/agent_1/prompt.txt");
    expect(refs.stdoutPath).toBe("agents/agent_1/stdout.log");
    expect(refs.stderrPath).toBe("agents/agent_1/stderr.log");
    expect(refs.rawResultPath).toBe("agents/agent_1/raw-result.json");
    expect(refs.normalizedResultPath).toBe("agents/agent_1/normalized-result.json");
    expect(refs.providerInvocationPath).toBe("agents/agent_1/provider-invocation.json");
  });

  it("writeStageArtifact writes stage details and child agent references", async () => {
    const { store, writes, writeJson } = createMockArtifactStore();

    const stageResult: PipelineStageResult = {
      stageName: "lint",
      stageIndex: 0,
      status: "succeeded",
      startedAt: "start",
      finishedAt: "finish",
      durationMs: 100,
      value: "out",
      childAgentIds: ["agent-1"]
    };

    const path = await writeStageArtifact(store, "pipeline-1", 3, stageResult);

    expect(path).toBe("/mock-root/pipelines/pipeline-1/items/3/stages/lint/stage-result.json");
    expect(writeJson).toHaveBeenCalled();
    const data = writes["pipelines/pipeline-1/items/3/stages/lint/stage-result.json"] as any;
    expect(data.stageName).toBe("lint");
    expect(data.childAgentArtifacts["agent-1"].dir).toBe("agents/agent-1");
  });

  it("writeItemArtifact writes item result to item.json", async () => {
    const { store, writes, writeJson } = createMockArtifactStore();

    const itemResult: PipelineItemResult = {
      itemIndex: 3,
      status: "succeeded",
      startedAt: "start",
      finishedAt: "finish",
      durationMs: 200,
      value: "output",
      stages: []
    };

    const path = await writeItemArtifact(store, "pipeline-1", 3, itemResult);

    expect(path).toBe("/mock-root/pipelines/pipeline-1/items/3/item.json");
    expect(writeJson).toHaveBeenCalled();
    const data = writes["pipelines/pipeline-1/items/3/item.json"] as any;
    expect(data.itemIndex).toBe(3);
    expect(data.status).toBe("succeeded");
  });

  it("writePipelineArtifact writes pipeline data to pipeline.json", async () => {
    const { store, writes, writeJson } = createMockArtifactStore();

    const pipelineData = {
      summary: { pipelineId: "pipeline-1", status: "succeeded" },
      results: []
    };

    const path = await writePipelineArtifact(store, "pipeline-1", pipelineData);

    expect(path).toBe("/mock-root/pipelines/pipeline-1/pipeline.json");
    expect(writeJson).toHaveBeenCalled();
    const data = writes["pipelines/pipeline-1/pipeline.json"] as any;
    expect(data.summary.pipelineId).toBe("pipeline-1");
    expect(data.summary.status).toBe("succeeded");
  });
});
