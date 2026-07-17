import type { ArtifactStore, AgentArtifacts } from "../types/artifacts.js";
import type { PipelineItemResult, PipelineStageResult } from "./types.js";
import { createPipelineStageArtifactName } from "./id.js";

export function buildAgentArtifactReferences(agentId: string): AgentArtifacts {
  const safeId = agentId.replace(/[^a-zA-Z0-9._:-]/g, "_");
  return {
    dir: `agents/${safeId}`,
    promptPath: `agents/${safeId}/prompt.txt`,
    stdoutPath: `agents/${safeId}/stdout.log`,
    stderrPath: `agents/${safeId}/stderr.log`,
    schemaPath: `agents/${safeId}/schema.json`,
    validationErrorPath: `agents/${safeId}/validation-error.json`,
    rawResultPath: `agents/${safeId}/raw-result.json`,
    normalizedResultPath: `agents/${safeId}/normalized-result.json`,
    providerInvocationPath: `agents/${safeId}/provider-invocation.json`
  };
}

export async function writeStageArtifact(
  artifactStore: ArtifactStore | undefined,
  pipelineId: string,
  itemIndex: number,
  result: PipelineStageResult
): Promise<string | undefined> {
  if (!artifactStore) return undefined;
  const safeStageName = createPipelineStageArtifactName(result.stageName);
  const relativePath = `pipelines/${pipelineId}/items/${itemIndex}/stages/${safeStageName}/stage-result.json`;

  const childAgentArtifacts: Record<string, AgentArtifacts> = {};
  if (result.childAgentIds) {
    for (const agentId of result.childAgentIds) {
      childAgentArtifacts[agentId] = buildAgentArtifactReferences(agentId);
    }
  }

  const stageArtifactData = {
    ...result,
    childAgentArtifacts
  };

  return await artifactStore.writeJson(relativePath, stageArtifactData);
}

export async function writeItemArtifact(
  artifactStore: ArtifactStore | undefined,
  pipelineId: string,
  itemIndex: number,
  result: PipelineItemResult
): Promise<string | undefined> {
  if (!artifactStore) return undefined;
  const relativePath = `pipelines/${pipelineId}/items/${itemIndex}/item.json`;

  return await artifactStore.writeJson(relativePath, result);
}

export async function writePipelineArtifact(
  artifactStore: ArtifactStore | undefined,
  pipelineId: string,
  pipelineData: unknown
): Promise<string | undefined> {
  if (!artifactStore) return undefined;
  const relativePath = `pipelines/${pipelineId}/pipeline.json`;

  return await artifactStore.writeJson(relativePath, pipelineData);
}
