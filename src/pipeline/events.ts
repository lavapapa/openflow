import type {
  PipelineStage,
  NormalizedPipelineOptions,
  PipelineItemResult,
  PipelineStageResult
} from "./types.js";
import type {
  PipelineStartedPayload,
  PipelineTerminalPayload,
  CompactPipelineItemResult,
  CompactPipelineStageResult,
  PipelineItemTerminalPayload,
  PipelineStageTerminalPayload,
  PipelineItemStartedPayload,
  PipelineStageStartedPayload
} from "../output/events.js";

export function compactStageResult(result: PipelineStageResult): CompactPipelineStageResult {
  const compact: CompactPipelineStageResult = {
    stageName: result.stageName,
    stageIndex: result.stageIndex,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    childAgentIds: [...result.childAgentIds]
  };
  if (result.error !== undefined) {
    compact.error = result.error;
  }
  return compact;
}

export function compactItemResult(result: PipelineItemResult): CompactPipelineItemResult {
  const compact: CompactPipelineItemResult = {
    itemIndex: result.itemIndex,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    stages: result.stages.map(compactStageResult)
  };
  if (result.status !== "succeeded") {
    const failRes = result as any;
    if (failRes.failedStage !== undefined) {
      compact.failedStage = failRes.failedStage;
    }
    if (failRes.error !== undefined) {
      compact.error = failRes.error;
    }
  }
  return compact;
}

export function buildPipelineStartedPayload(
  pipelineId: string,
  items: unknown[],
  stages: PipelineStage[],
  options: NormalizedPipelineOptions
): PipelineStartedPayload {
  return {
    pipelineId,
    label: options.label,
    strategy: options.strategy,
    itemCount: items.length,
    stages: stages.map((s) => s.name)
  };
}

export function buildPipelineTerminalPayload(
  pipelineId: string,
  status: "succeeded" | "failed" | "cancelled",
  durationMs: number,
  results: PipelineItemResult[],
  artifactPath?: string
): PipelineTerminalPayload {
  return {
    pipelineId,
    status,
    durationMs,
    results: results.map(compactItemResult),
    artifactPath
  };
}

export function buildPipelineItemStartedPayload(
  pipelineId: string,
  itemIndex: number,
  startedAt: string
): PipelineItemStartedPayload {
  return {
    pipelineId,
    itemIndex,
    startedAt
  };
}

export function buildPipelineItemTerminalPayload(
  pipelineId: string,
  result: PipelineItemResult
): PipelineItemTerminalPayload {
  return {
    pipelineId,
    ...compactItemResult(result)
  };
}

export function buildPipelineStageStartedPayload(
  pipelineId: string,
  itemIndex: number,
  stageName: string,
  stageIndex: number,
  startedAt: string
): PipelineStageStartedPayload {
  return {
    pipelineId,
    itemIndex,
    stageName,
    stageIndex,
    startedAt
  };
}

export function buildPipelineStageTerminalPayload(
  pipelineId: string,
  itemIndex: number,
  result: PipelineStageResult
): PipelineStageTerminalPayload {
  return {
    pipelineId,
    itemIndex,
    ...compactStageResult(result)
  };
}
