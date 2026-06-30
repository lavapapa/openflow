import type { AgentResult, AgentPermissions, AgentContextInput, AgentHandoffInput, AgentWorkspace } from "../types/agent.js";
import type { JsonSchema, ProviderName } from "../types/common.js";
import type { StructuredOutputConfig } from "../types/agent.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";


export interface AgentExecutionInput {
  id: string;
  label?: string;
  provider: ProviderName;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  structuredOutput?: StructuredOutputConfig;
  timeoutMs: number;
  cwd: string;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
  signal: AbortSignal;
  thinkingEffort?: ThinkingEffort;
  skills?: string[];
  context?: AgentContextInput;
  workspace?: AgentWorkspace;
  handoff?: AgentHandoffInput;
}

export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentResult>;
}
