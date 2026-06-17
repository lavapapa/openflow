import type {
  LoopHistoryEntry,
  LoopStatus,
  LoopRoundStatus,
  NormalizedLoopOptions,
} from "./types.js";
import type { SerializedError } from "../types/errors.js";
import type {
  LoopStartedPayload,
  LoopRoundStartedPayload,
  LoopRoundTerminalPayload,
  LoopTerminalPayload,
} from "../output/events.js";

/**
 * Builds the payload for a loop.started event.
 */
export function buildLoopStartedPayload(
  loopId: string,
  workflowInvocationId: string,
  options: NormalizedLoopOptions<any, any, any>,
  artifactPath: string
): LoopStartedPayload {
  return {
    loopId,
    workflowInvocationId,
    ...(options.label !== undefined ? { label: options.label } : {}),
    maxRounds: options.maxRounds,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    artifactPath,
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
  };
}

/**
 * Builds the payload for a loop.round.started event.
 */
export function buildLoopRoundStartedPayload(
  loopId: string,
  workflowInvocationId: string,
  roundIndex: number,
  roundId: string,
  startedAt: string,
  label?: string,
  artifactPath?: string
): LoopRoundStartedPayload {
  return {
    loopId,
    workflowInvocationId,
    ...(label !== undefined ? { label } : {}),
    roundIndex,
    roundId,
    startedAt,
    ...(artifactPath !== undefined ? { artifactPath } : {}),
  };
}

/**
 * Builds the payload for a loop.round terminal event (completed, failed, cancelled, timed_out).
 */
export function buildLoopRoundTerminalPayload(
  loopId: string,
  workflowInvocationId: string,
  roundIndex: number,
  roundId: string,
  status: LoopRoundStatus,
  durationMs: number,
  historyEntry: LoopHistoryEntry,
  label?: string,
  artifactPath?: string,
  error?: SerializedError
): LoopRoundTerminalPayload {
  return {
    loopId,
    workflowInvocationId,
    ...(label !== undefined ? { label } : {}),
    roundIndex,
    roundId,
    status,
    durationMs,
    break: historyEntry.break,
    ...(historyEntry.stopMatched !== undefined ? { stopMatched: historyEntry.stopMatched } : {}),
    ...(historyEntry.reason !== undefined ? { reason: historyEntry.reason } : {}),
    ...(artifactPath !== undefined ? { artifactPath } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * Builds the payload for a loop terminal event (satisfied, max_rounds, failed, cancelled, timed_out).
 */
export function buildLoopTerminalPayload(
  loopId: string,
  workflowInvocationId: string,
  status: LoopStatus,
  accepted: boolean,
  roundCount: number,
  maxRounds: number,
  durationMs: number,
  label?: string,
  reason?: string,
  artifactPath?: string,
  error?: SerializedError
): LoopTerminalPayload {
  return {
    loopId,
    workflowInvocationId,
    ...(label !== undefined ? { label } : {}),
    status,
    accepted,
    roundCount,
    maxRounds,
    durationMs,
    ...(reason !== undefined ? { reason } : {}),
    ...(artifactPath !== undefined ? { artifactPath } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}
