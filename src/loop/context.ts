import { AsyncLocalStorage } from "node:async_hooks";
import type {
  LoopRoundContext,
  LoopBreak,
  LoopStatus,
} from "./types.js";
import { createLoopAgentId } from "./id.js";
import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type { WorkflowCallInput, WorkflowSettledResult } from "../types/workflow.js";

/**
 * Internal state for the active loop round.
 */
export interface ActiveLoopContext {
  loopId: string;
  loopLabel?: string;
  roundIndex: number;
  roundId: string;
  childAgentIds: string[];
  signal: AbortSignal;
}

const loopContextStorage = new AsyncLocalStorage<ActiveLoopContext>();

/**
 * Returns the active loop context if currently executing inside a loop round.
 */
export function getActiveLoopContext(): ActiveLoopContext | undefined {
  return loopContextStorage.getStore();
}

/**
 * Runs a callback within an active loop context.
 */
export function withActiveLoopContext<T>(
  context: ActiveLoopContext,
  run: () => T
): T {
  return loopContextStorage.run(context, run);
}

/**
 * Records a child agent ID in the active loop context.
 */
export function recordLoopChildAgentId(agentId: string): void {
  const context = getActiveLoopContext();
  if (context) {
    if (!context.childAgentIds.includes(agentId)) {
      context.childAgentIds.push(agentId);
    }
  }
}

/**
 * Input for creating a loop round context.
 */
export interface CreateLoopRoundContextInput {
  loopId: string;
  loopLabel?: string;
  runId: string;
  artifactsDir: string;
  roundIndex: number;
  roundId: string;
  maxRounds: number;
  signal: AbortSignal;
  dsl: {
    agent: (input: AgentCallInput) => Promise<AgentResult>;
    workflow: (input: WorkflowCallInput) => Promise<any>;
    parallel: (tasks: any) => Promise<any>;
    log: (message: string, data?: any) => void;
  };
}

/**
 * Creates the context object passed to loop round callbacks.
 */
export function createLoopRoundContext<TState, TRoundResult, TFinal>(
  input: CreateLoopRoundContextInput
): LoopRoundContext<TState, TRoundResult, TFinal> {
  const { loopId, roundIndex, roundId, dsl } = input;
  let agentCounter = 0;

  return {
    loopId: input.loopId,
    ...(input.loopLabel !== undefined ? { loopLabel: input.loopLabel } : {}),
    runId: input.runId,
    artifactsDir: input.artifactsDir,
    roundIndex: input.roundIndex,
    roundId: input.roundId,
    maxRounds: input.maxRounds,
    signal: input.signal,

    agent: async (agentInput: AgentCallInput): Promise<AgentResult> => {
      let agentId: string;
      if (agentInput.id !== undefined) {
        agentId = agentInput.id;
      } else {
        agentCounter++;
        const suffix = agentInput.label?.trim();
        const idPattern = /^[A-Za-z0-9_.:-]+$/;
        const isValid = suffix &&
          suffix !== "" &&
          suffix !== "." &&
          suffix !== ".." &&
          !suffix.includes("/") &&
          !suffix.includes("\\") &&
          !suffix.includes("..") &&
          idPattern.test(suffix);

        if (isValid) {
          agentId = createLoopAgentId({
            loopId,
            roundIndex,
            suffix,
          });
        } else {
          agentId = createLoopAgentId({
            loopId,
            roundIndex,
            suffix: `agent-${agentCounter}`,
          });
        }
      }
      recordLoopChildAgentId(agentId);
      return dsl.agent({ ...agentInput, id: agentId });
    },

    workflow: async <T = unknown>(workflowInput: WorkflowCallInput): Promise<T | WorkflowSettledResult<T>> => {
      return dsl.workflow(workflowInput);
    },

    parallel: async <T>(tasks: any): Promise<any> => {
      return dsl.parallel(tasks);
    },

    log: (message: string, data?: any): void => {
      const logData = {
        ...(data && typeof data === "object" ? data : { raw: data }),
        loop: {
          loopId,
          roundIndex,
          roundId,
        },
      };
      dsl.log(message, logData);
    },

    agentId: (suffix?: string): string => {
      return createLoopAgentId({
        loopId,
        roundIndex,
        ...(suffix !== undefined ? { suffix } : {}),
      });
    },

    break: <TBreakFinal = TFinal>(
      value?: TBreakFinal,
      options?: { reason?: string; state?: TState }
    ): LoopBreak<TBreakFinal> => {
      return {
        __brand: "loop-break",
        ...(value !== undefined ? { value } : {}),
        ...(options?.reason !== undefined ? { reason: options.reason } : {}),
        ...(options?.state !== undefined ? { state: options.state } : {}),
      };
    },

    sleep: (ms: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        const abortHandler = () => {
          clearTimeout(timeout);
          input.signal.removeEventListener("abort", abortHandler);
          reject(input.signal.reason);
        };

        const timeout = setTimeout(() => {
          input.signal.removeEventListener("abort", abortHandler);
          resolve();
        }, ms);
        
        input.signal.addEventListener("abort", abortHandler);
      });
    },
  };
}
