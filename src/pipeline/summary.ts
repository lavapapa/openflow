import * as path from "node:path";
import type { PipelineSummary, PipelineStrategy, PipelineItemResult } from "./types.js";

export function buildPipelineSummary(params: {
  pipelineId: string;
  label?: string | undefined;
  strategy: PipelineStrategy;
  status: "succeeded" | "failed" | "cancelled";
  itemCount: number;
  results: PipelineItemResult[];
  stageNames: string[];
  durationMs: number;
  artifactsDir: string;
}): PipelineSummary {
  const {
    pipelineId,
    label,
    strategy,
    status,
    itemCount,
    results,
    stageNames,
    durationMs,
    artifactsDir
  } = params;

  const succeededCount = results.filter((r) => r.status === "succeeded").length;
  const failedCount = results.filter((r) => r.status === "failed" || r.status === "timed_out").length;
  const cancelledCount = results.filter((r) => r.status === "cancelled").length;
  const skippedCount = Math.max(0, itemCount - results.length);

  const artifactPath = path.join(artifactsDir, "pipelines", pipelineId, "pipeline.json");

  return {
    pipelineId,
    label,
    strategy,
    status,
    itemCount,
    succeededCount,
    failedCount,
    cancelledCount,
    skippedCount,
    stageNames,
    durationMs,
    artifactPath
  };
}
