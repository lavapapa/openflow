import type {
  PipelineStageResult,
  PipelineItemSuccess,
  PipelineItemFailure,
  PipelineStage
} from "./types.js";
import type { SerializedError } from "../types/errors.js";

export function getIsoTimestamp(): string {
  return new Date().toISOString();
}

export function getDurationMs(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, end - start);
}

export function createSucceededStageResult<O = unknown>(
  stageName: string,
  stageIndex: number,
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  value: O,
  childAgentIds: string[]
): PipelineStageResult<O> {
  const result: PipelineStageResult<O> = {
    stageName,
    stageIndex,
    status: "succeeded",
    startedAt,
    finishedAt,
    durationMs,
    childAgentIds: [...childAgentIds]
  };
  if (value !== undefined) {
    result.value = value;
  }
  return result;
}

export function createFailedStageResult(
  stageName: string,
  stageIndex: number,
  status: "failed" | "timed_out" | "cancelled",
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  error: SerializedError | undefined,
  childAgentIds: string[]
): PipelineStageResult {
  const result: PipelineStageResult = {
    stageName,
    stageIndex,
    status,
    startedAt,
    finishedAt,
    durationMs,
    childAgentIds: [...childAgentIds]
  };
  if (error !== undefined) {
    result.error = error;
  }
  return result;
}

export function createSkippedStageResult(
  stageName: string,
  stageIndex: number,
  timestamp: string
): PipelineStageResult {
  return {
    stageName,
    stageIndex,
    status: "skipped",
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    childAgentIds: []
  };
}

export function createItemSuccess<O = unknown>(
  itemIndex: number,
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  value: O,
  stages: PipelineStageResult[]
): PipelineItemSuccess<O> {
  return {
    itemIndex,
    status: "succeeded",
    startedAt,
    finishedAt,
    durationMs,
    value,
    stages
  };
}

export function createItemFailure(
  itemIndex: number,
  status: "failed" | "cancelled" | "timed_out",
  startedAt: string,
  finishedAt: string,
  durationMs: number,
  failedStage: string | undefined,
  error: SerializedError | undefined,
  stages: PipelineStageResult[]
): PipelineItemFailure {
  const result: PipelineItemFailure = {
    itemIndex,
    status,
    startedAt,
    finishedAt,
    durationMs,
    stages
  };
  if (failedStage !== undefined) {
    result.failedStage = failedStage;
  }
  if (error !== undefined) {
    result.error = error;
  }
  return result;
}

export function appendSkippedStages(
  stages: PipelineStageResult[],
  allStages: PipelineStage[],
  failedStageIndex: number,
  timestamp: string
): PipelineStageResult[] {
  const results = [...stages];
  for (let i = failedStageIndex + 1; i < allStages.length; i++) {
    const stage = allStages[i];
    if (stage) {
      results.push(createSkippedStageResult(stage.name, i, timestamp));
    }
  }
  return results;
}
