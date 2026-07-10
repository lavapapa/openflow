import type { AgentArtifacts } from "./artifacts.js";
import type { JsonSchema, ProviderName } from "./common.js";
import type { SerializedError } from "./errors.js";
import type { ThinkingEffort } from "./thinking-effort.js";


export type StructuredOutputTransport = "validate-only" | "prompt" | "native" | "auto";

export interface StructuredOutputConfig {
  transport?: StructuredOutputTransport | undefined;
}

export interface AgentPermissionsInput {
  mode: "dangerously-full-access" | "workspace-full-access";
}

export type AgentPermissions =
  | { mode: "default" }
  | { mode: "dangerously-full-access" }
  | { mode: "workspace-full-access" };

export type AgentWorkspaceMode = "shared" | "isolated";

export interface AgentWorkspaceInput {
  cwd?: string | undefined;
  mode?: AgentWorkspaceMode | undefined;
}

export interface AgentWorkspace {
  cwd: string;
  mode: AgentWorkspaceMode;
}

export interface AgentContextInput {
  files?: string[] | undefined;
  handoff?: string | string[] | undefined;
  notes?: string | undefined;
}

export interface AgentHandoffInput {
  writeTo?: string | undefined;
  instructions?: string | undefined;
  required?: boolean | undefined;
}

export interface DirectAgentCallInput {
  id?: string | undefined;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  permissions?: AgentPermissionsInput | undefined;
  metadata?: Record<string, unknown> | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  skills?: string[] | undefined;
  context?: AgentContextInput | undefined;
  workspace?: AgentWorkspaceInput | undefined;
  handoff?: AgentHandoffInput | undefined;
}

export interface DefinitionAgentCallInput {
  id?: string | undefined;
  definition: string;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  prompt?: string | undefined;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  permissions?: AgentPermissionsInput | undefined;
  metadata?: Record<string, unknown> | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  skills?: string[] | undefined;
  context?: AgentContextInput | undefined;
  workspace?: AgentWorkspaceInput | undefined;
  handoff?: AgentHandoffInput | undefined;
}

export type AgentCallInput = DirectAgentCallInput | DefinitionAgentCallInput;

export type AgentTaskState =
  | "queued"
  | "preparing"
  | "running"
  | "validating"
  | "collecting_artifacts"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped";

export type AgentResultStatus = "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped";

export type AgentResult = AgentSuccessResult | AgentFailureResult;

export interface AgentUsage {
  inputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningOutputTokens?: number | undefined;
  totalTokens?: number | undefined;
}

export interface AgentUsageSummary extends AgentUsage {
  agentCount: number;
  totalAgentCount?: number | undefined;
  splitUsageAgentCount?: number | undefined;
  totalOnlyUsageAgentCount?: number | undefined;
  missingUsageAgentCount?: number | undefined;
}

export interface AgentSuccessResult {
  ok: true;
  status: "succeeded";
  id: string;
  label?: string | undefined;
  provider: ProviderName;
  model?: string | undefined;
  text?: string | undefined;
  json?: unknown;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifacts: AgentArtifacts;
  cache?: AgentResultCacheInfo | undefined;
  permissions: AgentPermissions;
  usage?: AgentUsage | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AgentFailureResult {
  ok: false;
  status: "failed" | "timed_out" | "cancelled" | "skipped";
  id: string;
  label?: string | undefined;
  provider: ProviderName;
  model?: string | undefined;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  artifacts: AgentArtifacts;
  error: SerializedError;
  cache?: AgentResultCacheInfo | undefined;
  permissions: AgentPermissions;
  usage?: AgentUsage | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AgentResultCacheInfo {
  hit: boolean;
  callId?: string | undefined;
  previousRunId?: string | undefined;
  previousAgentId?: string | undefined;
}

export interface AgentRunInput {
  id: string;
  label?: string | undefined;
  provider: ProviderName;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs: number;
  cwd: string;
  env: Record<string, string>;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown> | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  skills?: string[] | undefined;
  context?: AgentContextInput | undefined;
  workspace?: AgentWorkspace | undefined;
  handoff?: AgentHandoffInput | undefined;
}

export interface ProviderHealth {
  provider: ProviderName;
  available: boolean;
  command?: string;
  version?: string;
  message?: string;
  error?: SerializedError;
  supportsModelSelection?: boolean;
}

export interface ProviderCommand {
  command: string;
  args: string[];
  stdin?: string | undefined;
  cwd: string;
  env?: Record<string, string> | undefined;
}

export interface ProviderParseInput {
  input: AgentRunInput;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ProviderParsedResult {
  text?: string | undefined;
  json?: unknown | undefined;
  structuredJson?: unknown | undefined;
  raw?: unknown | undefined;
  usage?: AgentUsage | undefined;
  parseWarnings?: string[] | undefined;
}

export interface AgentExecutionContext {
  signal: AbortSignal;
  emitOutput(stream: "stdout" | "stderr", data: string): Promise<void>;
}

export interface ProviderSdkExecutionResult {
  exitCode?: number | null | undefined;
  timedOut?: boolean | undefined;
  cancelled?: boolean | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  parsed?: ProviderParsedResult | undefined;
}

export interface AgentAdapter {
  name: ProviderName;
  kind?: "process" | "sdk" | undefined;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}

export interface AgentSdkAdapter extends AgentAdapter {
  kind: "sdk";
  execute(input: AgentRunInput, context: AgentExecutionContext): Promise<ProviderSdkExecutionResult>;
}
