import { AsyncLocalStorage } from "node:async_hooks";
import type { PipelineStrategy } from "./types.js";

export interface ActivePipelineContext {
  pipelineId: string;
  pipelineLabel?: string;
  strategy: PipelineStrategy;
  itemIndex: number;
  stageIndex: number;
  stageName: string;
  childAgentIds: string[];
  stageSignal?: AbortSignal;
  agentCounter: number;
}

const pipelineContextStorage = new AsyncLocalStorage<ActivePipelineContext>();

export function getActivePipelineContext(): ActivePipelineContext | undefined {
  return pipelineContextStorage.getStore();
}

export function withActivePipelineContext<T>(
  context: ActivePipelineContext,
  run: () => T
): T {
  return pipelineContextStorage.run(context, run);
}

export function recordChildAgentId(agentId: string): void {
  const context = getActivePipelineContext();
  if (context) {
    if (!context.childAgentIds.includes(agentId)) {
      context.childAgentIds.push(agentId);
    }
  }
}
