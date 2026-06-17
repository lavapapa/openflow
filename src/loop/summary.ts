import type { LoopResult, LoopSummary } from "./types.js";

/**
 * Builds a compact summary from a loop result.
 */
export function buildLoopSummary(result: LoopResult<any, any>): LoopSummary {
  return {
    loopId: result.loopId,
    ...(result.label !== undefined ? { label: result.label } : {}),
    status: result.status,
    accepted: result.accepted,
    roundCount: result.roundCount,
    maxRounds: result.maxRounds,
    durationMs: result.durationMs,
    artifactPath: result.artifactPath,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}
