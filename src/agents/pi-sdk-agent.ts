import { existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import type {
  AgentExecutionContext,
  AgentRunInput,
  AgentSdkAdapter,
  ProviderCommand,
  ProviderHealth,
  ProviderParseInput,
  ProviderParsedResult,
  ProviderSdkExecutionResult
} from "../types/agent.js";
import type { ProviderConfig } from "../config/types.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";

type PiSdkApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export interface PiSdkAgentProviderConfig extends ProviderConfig {
  piProvider?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  api?: PiSdkApi;
  agentDir?: string;
  tools?: string[];
  excludeTools?: string[];
  maxContextChars?: number;
  compaction?: boolean;
  retry?: boolean;
  sessionPersistence?: "memory" | "create" | "continue-recent" | "continue-recent-any-cwd";
  sessionDir?: string;
  sessionId?: string;
  sessionFile?: string;
}

export interface PiSdkAgentRuntimeOptions {
  customTools?: any[];
}

interface PiSdkModule {
  AuthStorage: any;
  createAgentSession: any;
  DefaultResourceLoader: any;
  getAgentDir: () => string;
  ModelRegistry: any;
  SessionManager: any;
  SettingsManager: any;
}

export class PiSdkAgentAdapter implements AgentSdkAdapter {
  readonly name = "pi-sdk";
  readonly kind = "sdk" as const;
  private readonly config: PiSdkAgentProviderConfig;
  private readonly runtimeOptions: PiSdkAgentRuntimeOptions;

  constructor(config?: PiSdkAgentProviderConfig, runtimeOptions?: PiSdkAgentRuntimeOptions) {
    this.config = config ?? {
      command: "pi-sdk",
      defaultModel: null
    };
    this.runtimeOptions = runtimeOptions ?? {};
  }

  async checkHealth(): Promise<ProviderHealth> {
    try {
      await loadPiSdk();
      return {
        provider: this.name,
        available: true,
        command: "in-process",
        supportsModelSelection: true
      };
    } catch (err) {
      return {
        provider: this.name,
        available: false,
        command: "in-process",
        message: "@earendil-works/pi-coding-agent is not installed.",
        error: {
          name: (err as Error).name,
          message: (err as Error).message
        },
        supportsModelSelection: true
      };
    }
  }

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    return {
      command: "<sdk:pi>",
      args: [
        "--provider",
        resolvePiProvider(this.config),
        "--model",
        resolveModel(input, this.config)
      ],
      cwd: input.cwd
    };
  }

  async execute(input: AgentRunInput, context: AgentExecutionContext): Promise<ProviderSdkExecutionResult> {
    const sdk = await loadPiSdk();
    const modelId = resolveModel(input, this.config);
    const piProvider = resolvePiProvider(this.config);
    const agentDir = path.resolve(this.config.agentDir ?? sdk.getAgentDir());
    const authStorage = sdk.AuthStorage.create(path.join(agentDir, "auth.json"));
    const apiKey = resolveApiKey(this.config);
    if (apiKey) {
      authStorage.setRuntimeApiKey(piProvider, apiKey);
    }

    const modelRegistry = sdk.ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));
    registerRuntimeProviderIfNeeded(modelRegistry, {
      provider: piProvider,
      model: modelId,
      config: this.config,
      apiKey
    });

    const model = modelRegistry.find(piProvider, modelId);
    if (!model) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.MODEL_CONFIG_INVALID,
        `Pi SDK model was not found: ${piProvider}/${modelId}`
      );
    }
    if (!modelRegistry.hasConfiguredAuth(model)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `Pi SDK auth is not configured for: ${piProvider}/${modelId}`
      );
    }

    const thinkingLevel = normalizeThinkingLevel(input.thinkingEffort ?? this.config.defaultThinkingEffort ?? this.config.thinking);
    const settingsManager = sdk.SettingsManager.inMemory({
      defaultProvider: piProvider,
      defaultModel: modelId,
      defaultThinkingLevel: thinkingLevel,
      compaction: { enabled: this.config.compaction !== false },
      retry: {
        enabled: this.config.retry !== false,
        maxRetries: 2,
        baseDelayMs: 800
      },
      quietStartup: true
    });

    const loader = new sdk.DefaultResourceLoader({
      cwd: input.cwd,
      agentDir,
      settingsManager,
      additionalSkillPaths: input.skills ?? [],
      noExtensions: this.config.noExtensions !== false,
      noThemes: this.config.noThemes !== false,
      noPromptTemplates: this.config.noPromptTemplates !== false,
      noContextFiles: this.config.noContextFiles === true,
      agentsFilesOverride: (current: { agentsFiles: Array<{ path: string; content: string }> }) => ({
        agentsFiles: [
          ...current.agentsFiles,
          {
            path: path.join(input.cwd, "OPENFLOW_AGENT_CONTEXT.md"),
            content: buildOpenFlowAgentContext(input)
          }
        ]
      }),
      appendSystemPrompt: [
        "You are running inside OpenFlow through the Pi SDK provider.",
        "Use the workspace filesystem as the source of truth. Read attached skill and context files before writing handoff files.",
        "Do not invoke OpenFlow recursively from this Pi agent session."
      ]
    });
    await loader.reload();

    const sessionManager = createPiSdkSessionManager(sdk, input, this.config);
    const { session } = await sdk.createAgentSession({
      cwd: input.cwd,
      agentDir,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel,
      resourceLoader: loader,
      settingsManager,
      sessionManager,
      tools: resolveTools(input, this.config),
      excludeTools: this.config.excludeTools,
      customTools: this.runtimeOptions.customTools
    });

    let streamedText = "";
    const pendingOutput: Array<Promise<void>> = [];
    const unsubscribe = session.subscribe((event: unknown) => {
      const delta = extractAssistantTextDelta(event);
      if (!delta) return;
      streamedText += delta;
      pendingOutput.push(context.emitOutput("stdout", delta));
    });
    const abortSession = () => {
      void session.abort().catch(() => undefined);
    };
    context.signal.addEventListener("abort", abortSession, { once: true });

    try {
      throwIfAborted(context.signal);
      await session.prompt(buildPiSdkPrompt(input), { expandPromptTemplates: false });
      throwIfAborted(context.signal);
      await Promise.all(pendingOutput);
      const text = session.getLastAssistantText?.()?.trim() || streamedText.trim();
      if (!text) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROVIDER_PROCESS_FAILED,
          `Pi SDK returned an empty response for ${piProvider}/${modelId}`
        );
      }
      return {
        exitCode: 0,
        parsed: {
          text,
          raw: {
            text,
            provider: piProvider,
            model: modelId,
            piSession: readPiSessionInfo(sessionManager)
          }
        }
      };
    } finally {
      context.signal.removeEventListener("abort", abortSession);
      unsubscribe();
      session.dispose();
    }
  }

  async parseResult(input: ProviderParseInput): Promise<ProviderParsedResult> {
    return {
      text: input.stdout,
      raw: { text: input.stdout }
    };
  }
}

export function createPiSdkSessionManager(
  sdk: Pick<PiSdkModule, "SessionManager">,
  input: Pick<AgentRunInput, "cwd">,
  config: Pick<PiSdkAgentProviderConfig, "sessionPersistence" | "sessionDir" | "sessionFile" | "sessionId">
): any {
  const mode = config.sessionPersistence ??
    (config.sessionFile || config.sessionDir || config.sessionId ? "continue-recent-any-cwd" : "memory");
  const sessionDir = config.sessionDir ? path.resolve(config.sessionDir) : undefined;
  const sessionFile = config.sessionFile ? path.resolve(config.sessionFile) : undefined;
  if (mode === "memory") return sdk.SessionManager.inMemory(input.cwd);
  if (sessionFile && existsSync(sessionFile)) {
    return sdk.SessionManager.open(sessionFile, sessionDir, input.cwd);
  }
  if (mode === "create") {
    return sdk.SessionManager.create(input.cwd, sessionDir, config.sessionId ? { id: config.sessionId } : undefined);
  }
  if (mode === "continue-recent") {
    return sdk.SessionManager.continueRecent(input.cwd, sessionDir);
  }
  const latest = sessionDir ? findMostRecentSessionFile(sessionDir) : null;
  if (latest) return sdk.SessionManager.open(latest, sessionDir, input.cwd);
  return sdk.SessionManager.create(input.cwd, sessionDir, config.sessionId ? { id: config.sessionId } : undefined);
}

function findMostRecentSessionFile(sessionDir: string): string | null {
  try {
    return readdirSync(sessionDir)
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => {
        const filePath = path.join(sessionDir, entry);
        return { filePath, mtimeMs: statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null;
  } catch {
    return null;
  }
}

function readPiSessionInfo(sessionManager: any) {
  return {
    persisted: Boolean(sessionManager?.isPersisted?.()),
    id: typeof sessionManager?.getSessionId === "function" ? sessionManager.getSessionId() : undefined,
    file: typeof sessionManager?.getSessionFile === "function" ? sessionManager.getSessionFile() : undefined,
    dir: typeof sessionManager?.getSessionDir === "function" ? sessionManager.getSessionDir() : undefined
  };
}

async function loadPiSdk(): Promise<PiSdkModule> {
  return await import("@earendil-works/pi-coding-agent") as unknown as PiSdkModule;
}

function resolvePiProvider(config: PiSdkAgentProviderConfig): string {
  const provider = config.piProvider?.trim();
  if (!provider) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.MODEL_CONFIG_INVALID,
      "Provider 'pi-sdk' requires piProvider."
    );
  }
  return provider;
}

function resolveModel(input: AgentRunInput, config: PiSdkAgentProviderConfig): string {
  const model = input.model ?? config.defaultModel ?? undefined;
  if (!model) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.MODEL_CONFIG_INVALID,
      "Provider 'pi-sdk' requires agent model or provider defaultModel."
    );
  }
  return model;
}

function resolveApiKey(config: PiSdkAgentProviderConfig): string | undefined {
  if (config.apiKey) return config.apiKey;
  if (config.apiKeyEnv) return process.env[config.apiKeyEnv];
  return undefined;
}

function registerRuntimeProviderIfNeeded(
  modelRegistry: any,
  input: {
    provider: string;
    model: string;
    config: PiSdkAgentProviderConfig;
    apiKey?: string | undefined;
  }
): void {
  if (!input.config.baseUrl) return;
  if (!input.apiKey) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `Provider 'pi-sdk' requires apiKey or apiKeyEnv when baseUrl is configured for ${input.provider}.`
    );
  }
  const api = input.config.api ?? "openai-completions";
  modelRegistry.registerProvider(input.provider, {
    baseUrl: input.config.baseUrl,
    api,
    apiKey: input.apiKey,
    authHeader: true,
    models: [
      {
        id: input.model,
        name: input.model,
        api,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false
        }
      }
    ]
  });
}

function normalizeThinkingLevel(value: string | undefined): ThinkingEffort {
  if (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return "medium";
}

function resolveTools(input: AgentRunInput, config: PiSdkAgentProviderConfig): string[] {
  if (config.tools?.length) return config.tools;
  if (input.permissions.mode === "dangerously-full-access") {
    return config.fullAccessTools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"];
  }
  return config.safeTools ?? ["read", "grep", "find", "ls"];
}

function buildPiSdkPrompt(input: AgentRunInput): string {
  const structured = resolveStructuredOutputPrompt({
    prompt: input.prompt,
    schema: input.schema,
    structuredOutput: input.structuredOutput
  });
  return [
    structured.prompt.trim(),
    "",
    renderAttachmentSection(input),
    input.handoff ? renderHandoffSection(input) : ""
  ].filter(Boolean).join("\n");
}

function buildOpenFlowAgentContext(input: AgentRunInput): string {
  return [
    "# OpenFlow Agent Context",
    "",
    `- Agent id: ${input.id}`,
    `- Provider: ${input.provider}`,
    `- Workspace: ${input.cwd}`,
    input.skills?.length ? `- Forced skills: ${input.skills.join(", ")}` : "",
    input.context?.files?.length ? `- Context files: ${input.context.files.join(", ")}` : "",
    normalizeContextHandoffs(input).length ? `- Upstream handoff files: ${normalizeContextHandoffs(input).join(", ")}` : "",
    input.handoff?.writeTo ? `- Requested handoff output: ${input.handoff.writeTo}` : "",
    "",
    "OpenFlow owns bounded workflow orchestration. Do not call OpenFlow recursively from this agent."
  ].filter(Boolean).join("\n");
}

function renderAttachmentSection(input: AgentRunInput): string {
  const lines: string[] = [];
  if (input.skills?.length) {
    lines.push("## Forced Skill Documents");
    for (const skill of input.skills) lines.push(`- ${skill}`);
  }
  if (input.context?.files?.length || normalizeContextHandoffs(input).length || input.context?.notes) {
    lines.push("", "## Attached Context");
    for (const file of input.context?.files ?? []) lines.push(`- Context file: ${file}`);
    for (const handoff of normalizeContextHandoffs(input)) lines.push(`- Upstream handoff: ${handoff}`);
    if (input.context?.notes) lines.push(`- Notes: ${clipText(input.context.notes, 4000)}`);
  }
  return lines.join("\n");
}

function renderHandoffSection(input: AgentRunInput): string {
  const handoff = input.handoff;
  if (!handoff) return "";
  return [
    "## Handoff Contract",
    handoff.writeTo ? `Write a concise handoff file to: ${handoff.writeTo}` : "",
    handoff.instructions ? `Instructions: ${handoff.instructions}` : "",
    handoff.required ? "The handoff file is required for this OpenFlow step to succeed." : "The handoff file is optional but recommended."
  ].filter(Boolean).join("\n");
}

function normalizeContextHandoffs(input: AgentRunInput): string[] {
  const handoff = input.context?.handoff;
  if (!handoff) return [];
  return Array.isArray(handoff) ? handoff : [handoff];
}

function extractAssistantTextDelta(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const typed = event as any;
  if (typed.type !== "message_update") return "";
  const messageEvent = typed.assistantMessageEvent;
  if (!messageEvent || typeof messageEvent !== "object") return "";
  if (messageEvent.type === "text_delta" && typeof messageEvent.delta === "string") {
    return messageEvent.delta;
  }
  return "";
}

function clipText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[clipped to ${maxChars} chars]`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Agent execution aborted");
}
