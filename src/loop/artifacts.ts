import * as path from "node:path";
import type { ArtifactStore } from "../types/artifacts.js";
import { createPreview } from "../tools/serialization.js";
import { cloneJsonValue } from "../workflow/json.js";
import type { LoopResult, LoopHistoryEntry, LoopReplayRecord } from "./types.js";

/**
 * Writes the loop definition artifact.
 */
export async function writeLoopDefinitionArtifact(
  artifactStore: ArtifactStore,
  loopId: string,
  data: unknown
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/loop.json`, cloneJsonValue(data, "loop definition"));
}

/**
 * Writes the loop history artifact.
 */
export async function writeLoopHistoryArtifact(
  artifactStore: ArtifactStore,
  loopId: string,
  history: LoopHistoryEntry[]
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/history.json`, history);
}

/**
 * Writes the loop result artifact.
 */
export async function writeLoopResultArtifact(
  artifactStore: ArtifactStore,
  loopId: string,
  result: LoopResult<any, any>
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/result.json`, result);
}

/**
 * Writes the loop replay record artifact.
 */
export async function writeLoopReplayArtifact(
  artifactStore: ArtifactStore,
  loopId: string,
  replayRecord: LoopReplayRecord
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/replay.json`, replayRecord);
}

/**
 * Writes all artifacts for a single round.
 */
export async function writeRoundArtifacts(
  artifactStore: ArtifactStore,
  loopId: string,
  roundIndex: number,
  data: {
    round: unknown;
    stateBefore: unknown;
    stateAfter?: unknown;
    result?: unknown;
    error?: unknown;
    control?: unknown;
    nestedCalls?: string[];
  }
): Promise<{ roundPath: string }> {
  const paddedIndex = roundIndex.toString().padStart(4, "0");
  const baseDir = `loops/${loopId}/rounds/${paddedIndex}`;

  const roundPath = await artifactStore.writeJson(`${baseDir}/round.json`, data.round);
  await artifactStore.writeJson(`${baseDir}/state.before.json`, cloneJsonValue(data.stateBefore, "round state.before"));
  
  if (data.stateAfter !== undefined) {
    await artifactStore.writeJson(`${baseDir}/state.after.json`, cloneJsonValue(data.stateAfter, "round state.after"));
  }
  
  if (data.result !== undefined) {
    await artifactStore.writeJson(`${baseDir}/result.preview.json`, createPreview(data.result));
  }
  
  if (data.error !== undefined) {
    await artifactStore.writeJson(`${baseDir}/error.json`, data.error);
  }

  if (data.control !== undefined) {
    await artifactStore.writeJson(`${baseDir}/control.json`, data.control);
  }
  
  if (data.nestedCalls !== undefined) {
    await artifactStore.writeJson(`${baseDir}/nested-calls.json`, data.nestedCalls);
  }

  return { roundPath };
}
