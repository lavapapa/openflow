import type { SerializedError } from "../types/errors.js";

export interface LoopOptions<TState, TRoundResult = unknown, TFinal = TRoundResult> {
  label?: string;
  maxRounds?: number;
  stopWhen?: (input: { round: LoopRoundView<TRoundResult>; state: TState; history: LoopHistoryEntry[] }) => boolean | Promise<boolean>;
  nextState?: (input: { state: TState; round: LoopRoundView<TRoundResult>; history: LoopHistoryEntry[] }) => TState | Promise<TState>;
  onFailureState?: (input: { state: TState; error: SerializedError; round: LoopHistoryEntry; history: LoopHistoryEntry[] }) => TState | Promise<TState>;
  failureMode?: "fail-fast" | "settled" | "continue";
  timeoutMs?: number;
  resultMode?: "history";
  metadata?: Record<string, unknown>;
}

export interface NormalizedLoopOptions<TState, TRoundResult, TFinal> extends LoopOptions<TState, TRoundResult, TFinal> {
  maxRounds: number;
  failureMode: LoopFailureMode;
  maxRoundsCeiling: number;
  presentOptions: string[];
}

export type LoopFailureMode = "fail-fast" | "settled" | "continue";

export type LoopStatus = "satisfied" | "max_rounds" | "failed" | "cancelled" | "timed_out";
export type LoopRoundStatus = "completed" | "failed" | "cancelled" | "timed_out";

export interface LoopResult<TState, TFinal> {
  schemaVersion: string;
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
}

export interface LoopRoundContext<TState, TRoundResult, TFinal> {
  loopId: string;
  loopLabel?: string;
  runId: string;
  artifactsDir: string;
  roundIndex: number;
  roundId: string;
  maxRounds: number;
  signal: AbortSignal;
  agent: (input: any) => Promise<any>;
  workflow: (input: any) => Promise<any>;
  parallel: (tasks: any) => Promise<any>;
  log: (message: string, data?: any) => void;
  agentId: (suffix?: string) => string;
  break: <TBreakFinal = TFinal>(value?: TBreakFinal, options?: { reason?: string; state?: TState }) => LoopBreak<TBreakFinal>;
  sleep: (ms: number) => Promise<void>;
}

export interface LoopHistoryEntry {
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
}

export interface LoopSummary {
  loopId: string;
  label?: string;
  status: LoopStatus;
  accepted: boolean;
  roundCount: number;
  maxRounds: number;
  durationMs: number;
  artifactPath: string;
  reason?: string;
  error?: SerializedError;
}

export interface LoopBreak<TFinal> {
  __brand: "loop-break";
  value?: TFinal;
  reason?: string;
  state?: unknown;
}

export interface LoopReplayRecord {
  loopId: string;
  label?: string;
  optionsFingerprint: string;
  initialStateHash: string;
  maxRounds: number;
  maxRoundsCeiling: number;
  rounds: Array<{
    index: number;
    roundId: string;
    stateBeforeHash: string;
    stateAfterHash?: string;
    break: boolean;
    stopMatched?: boolean;
    terminalReason?: string;
    nestedCallSequence: string[];
  }>;
}

export interface LoopReturnBreak<TFinal> {
  break: true;
  value?: TFinal;
  reason?: string;
  state?: unknown;
}

export type TRoundReturn<TRoundResult, TFinal> = TRoundResult | LoopBreak<TFinal> | LoopReturnBreak<TFinal>;

export interface LoopRoundView<TRoundResult> {
  index: number;
  roundId: string;
  status: LoopRoundStatus;
  result?: TRoundResult;
  error?: SerializedError;
  durationMs: number;
}
