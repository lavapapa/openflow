import type {
  LoopResult,
  LoopHistoryEntry,
  LoopRoundView,
  LoopStatus,
  LoopRoundStatus,
  LoopBreak,
  LoopReturnBreak,
  TRoundReturn,
} from "./types.js";
import type { SerializedError } from "../types/errors.js";

/**
 * Returns the current ISO timestamp.
 */
export function getIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Calculates duration between two ISO timestamps.
 */
export function getDurationMs(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, end - start);
}

/**
 * Creates a concise history entry for a round.
 */
export function createHistoryEntry(input: {
  index: number;
  status: LoopRoundStatus;
  state: any;
  nextState?: any;
  result?: any;
  error?: SerializedError;
  break: boolean;
  stopMatched?: boolean;
  reason?: string;
  durationMs: number;
  artifactPath?: string;
}): LoopHistoryEntry {
  return {
    index: input.index,
    status: input.status,
    state: input.state,
    ...(input.nextState !== undefined ? { nextState: input.nextState } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    break: input.break,
    ...(input.stopMatched !== undefined ? { stopMatched: input.stopMatched } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    durationMs: input.durationMs,
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
  };
}

/**
 * Creates a concise round view for predicates.
 */
export function createRoundView<TRoundResult>(input: {
  index: number;
  roundId: string;
  status: LoopRoundStatus;
  result?: TRoundResult;
  error?: SerializedError;
  durationMs: number;
}): LoopRoundView<TRoundResult> {
  return {
    index: input.index,
    roundId: input.roundId,
    status: input.status,
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    durationMs: input.durationMs,
  };
}

/**
 * Checks if a value is a branded LoopBreak.
 */
export function isLoopBreak(value: unknown): value is LoopBreak<any> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as any).__brand === "loop-break"
  );
}

/**
 * Checks if a value is a plain break object { break: true }.
 */
export function isPlainBreakObject(value: unknown): value is LoopReturnBreak<any> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as any).break === true
  );
}

/**
 * Normalizes a round return value into break signals and results.
 */
export function normalizeBreakReturn<TRoundResult, TFinal>(
  value: TRoundReturn<TRoundResult, TFinal>
): {
  isBreak: boolean;
  finalValue?: TFinal;
  reason?: string;
  roundResult?: TRoundResult;
  finalState?: unknown;
} {
  if (isLoopBreak(value)) {
    return {
      isBreak: true,
      ...(value.value !== undefined ? { finalValue: value.value } : {}),
      ...(value.reason !== undefined ? { reason: value.reason } : {}),
      ...(value.state !== undefined ? { finalState: value.state } : {}),
    };
  }
  if (isPlainBreakObject(value)) {
    return {
      isBreak: true,
      ...(value.value !== undefined ? { finalValue: value.value } : {}),
      ...(value.reason !== undefined ? { reason: value.reason } : {}),
      ...(value.state !== undefined ? { finalState: value.state } : {}),
    };
  }
  return { isBreak: false, roundResult: value as TRoundResult };
}

/**
 * Builds the final LoopResult.
 */
export function buildLoopResult<TState, TFinal>(input: {
  loopId: string;
  label?: string;
  status: LoopStatus;
  accepted: boolean;
  roundCount: number;
  maxRounds: number;
  finalState: TState;
  final?: TFinal;
  reason?: string;
  history: LoopHistoryEntry[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactPath: string;
  error?: SerializedError;
}): LoopResult<TState, TFinal> {
  return {
    schemaVersion: "open-dynamic-workflow.loop-result.v1",
    loopId: input.loopId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    status: input.status,
    accepted: input.accepted,
    roundCount: input.roundCount,
    maxRounds: input.maxRounds,
    finalState: input.finalState,
    ...(input.final !== undefined ? { final: input.final } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    history: [...input.history],
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    artifactPath: input.artifactPath,
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
}
