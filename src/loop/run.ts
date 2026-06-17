import { validateAndNormalizeLoopArgs } from "./validate.js";
import { createLoopId, createRoundId } from "./id.js";
import {
  buildLoopStartedPayload,
  buildLoopRoundStartedPayload,
  buildLoopRoundTerminalPayload,
  buildLoopTerminalPayload,
} from "./events.js";
import {
  writeLoopDefinitionArtifact,
  writeRoundArtifacts,
  writeLoopHistoryArtifact,
  writeLoopResultArtifact,
} from "./artifacts.js";
import {
  getIsoTimestamp,
  getDurationMs,
  createHistoryEntry,
  createRoundView,
  normalizeBreakReturn,
  buildLoopResult,
} from "./results.js";
import { createLoopRoundContext, withActiveLoopContext } from "./context.js";
import {
  stableHashJson,
  buildLoopStartReplayMarker,
  buildLoopRoundReplayMarker,
  recordLoopCacheMarker,
} from "./replay.js";
import { withToolForbidden } from "../workflow/scope.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { getActiveWorkflowInvocation } from "../workflow/invocation-types.js";
import { cloneJsonValue } from "../workflow/json.js";
import { serializeError } from "../errors/serialize.js";
import { buildLoopSummary } from "./summary.js";
import type {
  LoopOptions,
  LoopResult,
  LoopRoundContext,
  LoopHistoryEntry,
  LoopStatus,
  LoopRoundStatus,
  LoopSummary,
} from "./types.js";
import type { RuntimeState } from "../workflow/types.js";
import type { SerializedError } from "../types/errors.js";
import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type {
  ParallelTasks,
  WorkflowCallInput,
  WorkflowSettledResult,
} from "../types/workflow.js";

/**
 * Input for runLoop.
 */
export interface RunLoopInput<TState = unknown, TRoundResult = unknown, TFinal = unknown> {
  initialState: TState;
  runRound: (
    state: TState,
    ctx: LoopRoundContext<TState, TRoundResult, TFinal>
  ) => Promise<unknown> | unknown;
  options?: LoopOptions<TState, TRoundResult, TFinal>;
  runtime: RuntimeState;
  signal: AbortSignal;
  dsl: {
    agent: (input: AgentCallInput) => Promise<AgentResult>;
    workflow: (input: WorkflowCallInput) => Promise<any>;
    parallel: (tasks: ParallelTasks<any>) => Promise<any>;
    log: (message: string, data?: unknown) => void;
  };
}

function terminalLoopEventType(status: LoopStatus): "loop.completed" | "loop.failed" | "loop.cancelled" | "loop.timed_out" {
  if (status === "failed") return "loop.failed";
  if (status === "cancelled") return "loop.cancelled";
  if (status === "timed_out") return "loop.timed_out";
  return "loop.completed";
}

function terminalRoundEventType(status: LoopRoundStatus): "loop.round.completed" | "loop.round.failed" | "loop.round.cancelled" | "loop.round.timed_out" {
  if (status === "failed") return "loop.round.failed";
  if (status === "cancelled") return "loop.round.cancelled";
  if (status === "timed_out") return "loop.round.timed_out";
  return "loop.round.completed";
}

/**
 * Main loop execution runtime.
 */
export async function runLoop<TState = unknown, TRoundResult = unknown, TFinal = unknown>(
  input: RunLoopInput<TState, TRoundResult, TFinal>
): Promise<LoopResult<TState, TFinal>> {
  const { runtime, signal, dsl } = input;

  // 1. Normalize options
  const maxRoundsCeiling = runtime.config?.workflow?.maxLoopRounds ?? 60;
  const normalizedOptions = validateAndNormalizeLoopArgs<TState, TRoundResult, TFinal>(
    input.initialState,
    input.runRound,
    input.options,
    maxRoundsCeiling
  );

  // 2. Allocate loopId
  const loopSequence = (runtime.loopCounter ?? 0) + 1;
  runtime.loopCounter = loopSequence;
  const loopId = createLoopId(loopSequence);

  // 3. Timeout handling
  let timeoutHandle: NodeJS.Timeout | undefined;
  let parentAbortListener: (() => void) | undefined;
  let timeoutController: AbortController | undefined;
  let loopSignal = signal;

  if (normalizedOptions.timeoutMs) {
    timeoutController = new AbortController();
    timeoutHandle = setTimeout(() => {
      timeoutController?.abort(
        new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_TIMEOUT, `Loop ${loopId} timed out after ${normalizedOptions.timeoutMs}ms.`)
      );
    }, normalizedOptions.timeoutMs);
    
    parentAbortListener = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutController?.abort(signal.reason);
    };
    signal.addEventListener("abort", parentAbortListener);
    loopSignal = timeoutController.signal;
  }

  try {
    const startedAt = getIsoTimestamp();
    const loopArtifactDir = `loops/${loopId}`;

    // 4. Emit loop.started
    const workflowInvocationId = getActiveWorkflowInvocation()?.workflowInvocationId ?? runtime.runId;
    runtime.eventSink.emit("loop.started", buildLoopStartedPayload(loopId, workflowInvocationId, normalizedOptions, loopArtifactDir));

    // 5. Write loop.json
    const serializableOptions = { ...normalizedOptions } as any;
    delete serializableOptions.stopWhen;
    delete serializableOptions.nextState;
    delete serializableOptions.onFailureState;

    await writeLoopDefinitionArtifact(runtime.artifactStore!, loopId, {
      options: serializableOptions,
      initialState: cloneJsonValue(input.initialState, "initial state"),
    });

    // 6. Record loop-start replay marker
    const optionsFingerprint = stableHashJson(normalizedOptions);
    const initialStateHash = stableHashJson(input.initialState);
    const loopStartMarker = buildLoopStartReplayMarker({
      loopId,
      ...(normalizedOptions.label !== undefined ? { label: normalizedOptions.label } : {}),
      optionsFingerprint,
      initialStateHash,
      maxRounds: normalizedOptions.maxRounds,
      maxRoundsCeiling,
    });

    const callSequence = (runtime.callSequence ?? 0) + 1;
    runtime.callSequence = callSequence;
    await recordLoopCacheMarker({
      store: runtime.artifactStore!,
      ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
      kind: "loop",
      sequence: callSequence,
      loopId,
      fingerprint: loopStartMarker,
      resultPath: `${loopArtifactDir}/loop.json`,
    });

    let currentState = input.initialState;
    const history: LoopHistoryEntry[] = [];
    let loopStatus: LoopStatus | undefined;
    let loopAccepted = false;
    let loopError: SerializedError | undefined;
    let finalValue: TFinal | undefined;
    const nestedCallIdsAcrossRounds: string[] = [];

    // 7. Loop execution
    for (let roundIndex = 1; roundIndex <= normalizedOptions.maxRounds; roundIndex++) {
      const roundStartedAt = getIsoTimestamp();
      const roundId = createRoundId(loopId, roundIndex);
      const roundArtifactDir = `loops/${loopId}/rounds/${roundIndex.toString().padStart(4, "0")}`;

      // Check cancellation/timeout
      if (loopSignal.aborted) {
        break;
      }

      // Round context
      const activeRoundContext = {
        loopId,
        ...(normalizedOptions.label !== undefined ? { loopLabel: normalizedOptions.label } : {}),
        roundIndex,
        roundId,
        childAgentIds: [],
        signal: loopSignal,
      };

      const ctx = createLoopRoundContext<TState, TRoundResult, TFinal>({
        loopId,
        ...(normalizedOptions.label !== undefined ? { loopLabel: normalizedOptions.label } : {}),
        runId: runtime.runId,
        artifactsDir: runtime.artifactsDir,
        roundIndex,
        roundId,
        maxRounds: normalizedOptions.maxRounds,
        signal: loopSignal,
        dsl,
      });

      // Write state.before.json and emit round started
      await runtime.artifactStore!.writeJson(`${roundArtifactDir}/state.before.json`, cloneJsonValue(currentState, "round state.before"));
      runtime.eventSink.emit("loop.round.started", buildLoopRoundStartedPayload(loopId, workflowInvocationId, roundIndex, roundId, roundStartedAt, normalizedOptions.label, roundArtifactDir));

      let roundResult: unknown;
      let roundError: any;
      let roundStatus: LoopRoundStatus = "completed";
      let abortListener: (() => void) | undefined;

      try {
        const abortPromise = new Promise<never>((_, reject) => {
          if (loopSignal.aborted) {
            reject(loopSignal.reason || new Error("Aborted"));
            return;
          }
          abortListener = () => {
            reject(loopSignal.reason || new Error("Aborted"));
          };
          loopSignal.addEventListener("abort", abortListener);
        });

        const roundPromise = withActiveLoopContext(activeRoundContext, async () => {
          return withToolForbidden("loop-round", () => {
            return input.runRound(currentState, ctx);
          });
        });

        roundResult = await Promise.race([roundPromise, abortPromise]);
      } catch (err: any) {
        roundError = err;
        if (signal.aborted) {
          roundStatus = "cancelled";
        } else if (loopSignal.aborted) {
          roundStatus = "timed_out";
        } else {
          roundStatus = err.name === "AbortError" || err.code === "WORKFLOW_CANCELLED" ? "cancelled" : 
                        err.code === "WORKFLOW_TIMEOUT" ? "timed_out" : "failed";
        }
      } finally {
        if (abortListener) {
          loopSignal.removeEventListener("abort", abortListener);
        }
      }

      const roundFinishedAt = getIsoTimestamp();
      const roundDurationMs = getDurationMs(roundStartedAt, roundFinishedAt);

      if (roundStatus === "completed") {
        const normalized = normalizeBreakReturn<TRoundResult, TFinal>(roundResult as any);
        let stopMatched = false;
        let terminalStatus: LoopStatus | undefined;
        let terminalReason: string | undefined;
        let nextStateApplied = false;
        let stateAfter = currentState;

        // PRE-CONTROL BASE ENTRY (for callbacks)
        const baseHistoryEntry = createHistoryEntry({
          index: roundIndex,
          status: "completed",
          state: cloneJsonValue(currentState, "round state"),
          result: normalized.roundResult,
          break: normalized.isBreak,
          durationMs: roundDurationMs,
          artifactPath: roundArtifactDir,
        });
        const historyForCallbacks = [...history, baseHistoryEntry];

        if (normalized.isBreak) {
          terminalStatus = "satisfied";
          terminalReason = normalized.reason;
          stateAfter = normalized.finalState !== undefined ? (normalized.finalState as TState) : currentState;
        } else {
          const roundView = createRoundView<TRoundResult>({
            index: roundIndex,
            roundId,
            status: "completed",
            ...(normalized.roundResult !== undefined ? { result: normalized.roundResult } : {}),
            durationMs: roundDurationMs,
          });

          // stopWhen
          if (normalizedOptions.stopWhen) {
            const stop = await normalizedOptions.stopWhen({ round: roundView, state: currentState, history: historyForCallbacks });
            if (stop) {
              stopMatched = true;
              terminalStatus = "satisfied";
              terminalReason = "stopWhen satisfied";
            }
          }

          if (!terminalStatus && roundIndex >= normalizedOptions.maxRounds) {
            terminalStatus = "max_rounds";
          }

          if (!terminalStatus) {
            if (normalizedOptions.nextState) {
              stateAfter = await normalizedOptions.nextState({ state: currentState, round: roundView, history: historyForCallbacks });
              nextStateApplied = true;
            } else {
              // R003: default state progression - leave stateAfter as currentState
              stateAfter = currentState;
            }
          }
        }

        const historyEntry = createHistoryEntry({
          index: roundIndex,
          status: "completed",
          state: cloneJsonValue(currentState, "round state"),
          nextState: cloneJsonValue(stateAfter, "round nextState"),
          result: normalized.roundResult,
          break: normalized.isBreak,
          stopMatched,
          ...(terminalReason !== undefined ? { reason: terminalReason } : {}),
          durationMs: roundDurationMs,
          artifactPath: roundArtifactDir,
        });

        // Write round artifacts
        await writeRoundArtifacts(runtime.artifactStore!, loopId, roundIndex, {
          round: historyEntry,
          stateBefore: currentState,
          stateAfter: stateAfter,
          result: normalized.roundResult,
          control: {
            break: normalized.isBreak,
            stopWhenEvaluated: !!normalizedOptions.stopWhen && !normalized.isBreak,
            stopMatched,
            maxRoundsReachedAfterRound: roundIndex >= normalizedOptions.maxRounds && !normalized.isBreak && !stopMatched,
            nextStateApplied,
            terminalStatus,
          },
          nestedCalls: activeRoundContext.childAgentIds,
        });

        history.push(historyEntry);
        nestedCallIdsAcrossRounds.push(...activeRoundContext.childAgentIds);

        // Record round replay marker
        const roundMarker = buildLoopRoundReplayMarker({
          loopId,
          roundId,
          roundIndex,
          stateBeforeHash: stableHashJson(currentState),
          stateAfterHash: stableHashJson(stateAfter),
          break: normalized.isBreak,
          stopMatched,
          ...(terminalReason !== undefined ? { terminalReason } : {}),
          nestedCallSequence: activeRoundContext.childAgentIds,
        });

        const roundCallSequence: number = (runtime.callSequence ?? 0) + 1;
        runtime.callSequence = roundCallSequence;
        await recordLoopCacheMarker({
          store: runtime.artifactStore!,
          ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
          kind: "loop",
          sequence: roundCallSequence,
          loopId,
          roundIndex,
          roundId,
          fingerprint: roundMarker,
          resultPath: `${roundArtifactDir}/round.json`,
        });

        runtime.eventSink.emit("loop.round.completed", buildLoopRoundTerminalPayload(loopId, workflowInvocationId, roundIndex, roundId, "completed", roundDurationMs, historyEntry, normalizedOptions.label, roundArtifactDir));

        if (terminalStatus) {
          loopStatus = terminalStatus;
          loopAccepted = terminalStatus === "satisfied";
          if (normalized.isBreak) {
            finalValue = normalized.finalValue;
          }
          currentState = stateAfter as TState;
          break;
        }

        currentState = stateAfter as TState;
      } else {
        // Round failed
        const serializedError = serializeError(roundError);
        const historyEntry = createHistoryEntry({
          index: roundIndex,
          status: roundStatus,
          state: cloneJsonValue(currentState, "round state"),
          error: serializedError,
          break: false,
          durationMs: roundDurationMs,
          artifactPath: roundArtifactDir,
        });

        await writeRoundArtifacts(runtime.artifactStore!, loopId, roundIndex, {
          round: historyEntry,
          stateBefore: currentState,
          error: serializedError,
          control: {
            break: false,
            terminalStatus: roundStatus,
          },
          nestedCalls: activeRoundContext.childAgentIds,
        });

        history.push(historyEntry);
        nestedCallIdsAcrossRounds.push(...activeRoundContext.childAgentIds);

        // Record failed round replay marker
        const roundMarker = buildLoopRoundReplayMarker({
          loopId,
          roundId,
          roundIndex,
          stateBeforeHash: stableHashJson(currentState),
          break: false,
          terminalReason: serializedError.message,
          nestedCallSequence: activeRoundContext.childAgentIds,
        });

        const roundCallSequence: number = (runtime.callSequence ?? 0) + 1;
        runtime.callSequence = roundCallSequence;
        await recordLoopCacheMarker({
          store: runtime.artifactStore!,
          ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
          kind: "loop",
          sequence: roundCallSequence,
          loopId,
          roundIndex,
          roundId,
          fingerprint: roundMarker,
          resultPath: `${roundArtifactDir}/round.json`,
          status: roundStatus,
        });

        runtime.eventSink.emit(
          terminalRoundEventType(roundStatus),
          buildLoopRoundTerminalPayload(loopId, workflowInvocationId, roundIndex, roundId, roundStatus, roundDurationMs, historyEntry, normalizedOptions.label, roundArtifactDir, serializedError)
        );

        if (roundStatus === "timed_out" || roundStatus === "cancelled") {
          loopStatus = roundStatus;
          loopError = serializedError;
          break;
        }

        if (normalizedOptions.failureMode === "fail-fast") {
          loopStatus = "failed";
          loopError = serializedError;
          break;
        } else if (normalizedOptions.failureMode === "settled") {
          loopStatus = "failed";
          loopError = serializedError;
          break;
        } else if (normalizedOptions.failureMode === "continue" && normalizedOptions.onFailureState) {
          try {
            currentState = await normalizedOptions.onFailureState({ state: currentState, error: serializedError, round: historyEntry, history });
          } catch (err: any) {
            loopStatus = "failed";
            loopError = serializeError(err);
            break;
          }
        } else {
          // Should not reach here due to validation, but as a fallback fail-fast
          loopStatus = "failed";
          loopError = serializedError;
          break;
        }
      }
    }

    // 8. Finalize
    const finishedAt = getIsoTimestamp();
    const durationMs = getDurationMs(startedAt, finishedAt);

    if (!loopStatus) {
      if (loopSignal.aborted) {
        if (signal.aborted) {
          loopStatus = "cancelled";
        } else {
          loopStatus = "timed_out";
        }
        loopError = serializeError(loopSignal.reason);
      } else {
        loopStatus = "failed"; // Should not happen
      }
    }

    const result = buildLoopResult<TState, TFinal>({
      loopId,
      ...(normalizedOptions.label !== undefined ? { label: normalizedOptions.label } : {}),
      status: loopStatus,
      accepted: loopAccepted,
      roundCount: history.length,
      maxRounds: normalizedOptions.maxRounds,
      finalState: currentState,
      ...(finalValue !== undefined ? { final: finalValue } : {}),
      history,
      startedAt,
      finishedAt,
      durationMs,
      artifactPath: loopArtifactDir,
      ...(loopError !== undefined ? { error: loopError } : {}),
    });

    // 9. Write artifacts and summaries
    await writeLoopHistoryArtifact(runtime.artifactStore!, loopId, history);
    await writeLoopResultArtifact(runtime.artifactStore!, loopId, result);

    const summary = buildLoopSummary(result);

    if (!runtime.loopSummaries) {
      runtime.loopSummaries = [];
    }
    runtime.loopSummaries.push(summary);

    runtime.eventSink.emit(
      terminalLoopEventType(loopStatus),
      buildLoopTerminalPayload(loopId, workflowInvocationId, loopStatus, loopAccepted, history.length, normalizedOptions.maxRounds, durationMs, normalizedOptions.label, summary.reason, loopArtifactDir, loopError)
    );

    if (loopStatus === "failed" && normalizedOptions.failureMode === "fail-fast") {
      throw loopError;
    }

    return result;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (parentAbortListener) {
      signal.removeEventListener("abort", parentAbortListener);
    }
  }
}
