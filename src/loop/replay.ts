import * as crypto from "node:crypto";
import { findPrefixCacheHit, recordLoopCall, type RuntimeCallCache, type LoopCallCacheEntry } from "../artifacts/call-cache.js";
import type { ArtifactStore } from "../types/artifacts.js";

/**
 * Stable JSON stringify for consistent hashing.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = sortValue(child);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Computes a stable hash of a JSON-serializable value.
 */
export function stableHashJson(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

/**
 * Builds a loop-start replay marker.
 */
export function buildLoopStartReplayMarker(input: {
  loopId: string;
  label?: string;
  optionsFingerprint: string;
  initialStateHash: string;
  maxRounds: number;
  maxRoundsCeiling: number;
}): string {
  return stableHashJson({
    kind: "loop-start",
    loopId: input.loopId,
    label: input.label,
    optionsFingerprint: input.optionsFingerprint,
    initialStateHash: input.initialStateHash,
    maxRounds: input.maxRounds,
    maxRoundsCeiling: input.maxRoundsCeiling,
  });
}

/**
 * Builds a loop-round replay marker.
 */
export function buildLoopRoundReplayMarker(input: {
  loopId: string;
  roundId: string;
  roundIndex: number;
  stateBeforeHash: string;
  stateAfterHash?: string;
  break: boolean;
  stopMatched?: boolean;
  terminalReason?: string;
  nestedCallSequence: string[];
}): string {
  return stableHashJson({
    kind: "loop-round",
    loopId: input.loopId,
    roundId: input.roundId,
    roundIndex: input.roundIndex,
    stateBeforeHash: input.stateBeforeHash,
    stateAfterHash: input.stateAfterHash,
    break: input.break,
    stopMatched: input.stopMatched,
    terminalReason: input.terminalReason,
    nestedCallSequence: input.nestedCallSequence,
  });
}

/**
 * Records a loop cache marker and checks for a prefix cache hit.
 * If there's a mismatch, it disables further cache hits.
 */
export async function recordLoopCacheMarker(input: {
  store: ArtifactStore;
  cache?: RuntimeCallCache;
  kind: "loop";
  sequence: number;
  loopId: string;
  roundIndex?: number;
  roundId?: string;
  fingerprint: string;
  resultPath: string;
  status?: "succeeded" | "failed" | "cancelled" | "timed_out" | "skipped";
}): Promise<LoopCallCacheEntry | undefined> {
  const hit = findPrefixCacheHit({
    cache: input.cache,
    kind: "loop",
    sequence: input.sequence,
    callId: input.loopId,
    fingerprint: input.fingerprint,
  });

  await recordLoopCall({
    store: input.store,
    ...(input.cache !== undefined ? { cache: input.cache } : {}),
    sequence: input.sequence,
    loopId: input.loopId,
    ...(input.roundIndex !== undefined ? { roundIndex: input.roundIndex } : {}),
    ...(input.roundId !== undefined ? { roundId: input.roundId } : {}),
    fingerprint: input.fingerprint,
    resultPath: input.resultPath,
    ...(input.status !== undefined ? { status: input.status } : {}),
  });

  return hit;
}
