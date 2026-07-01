import type { AgentExecutor, AgentExecutionInput } from "./execution-types.js";
import type {
  AgentResult,
  AgentSuccessResult,
  AgentFailureResult,
  AgentRunInput,
  AgentPermissions,
  ProviderCommand,
  AgentSdkAdapter,
  ProviderParsedResult
} from "../types/agent.js";
import type { ResolvedConfig } from "../types/config.js";
import type { ArtifactStore, AgentArtifacts } from "../types/artifacts.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  AgentVerboseCommandPayload,
  AgentVerboseResultPayload
} from "../output/events.js";
import { EventBus } from "../orchestration/event-bus.js";
import { createDefaultProviderRegistry, type ProviderRuntimeMap } from "./registry.js";
import { runProcess } from "./process-runner.js";
import { normalizeAgentOutput } from "../structured/normalize-agent-output.js";
import {
  buildProviderEnv,
  redactText,
  StreamRedactor,
  collectSecretValues,
  redactJsonValue,
  redactProviderCommand,
  redactSerializedError
} from "../security/env.js";
import { sanitizeMetadata } from "../security/metadata.js";
import { assertThinkingEffortSupported } from "./thinking-effort-support.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

const MAX_IN_MEMORY_LOG_SIZE = 1024 * 1024; // 1MB limit for in-memory results

interface MockAdapterWithLookup {
  lookupResponse(input: AgentRunInput): any;
  buildCommand(input: AgentRunInput): Promise<any>;
}

function isMockAdapter(adapter: any): adapter is MockAdapterWithLookup {
  return typeof adapter.lookupResponse === "function";
}

function isSdkAdapter(adapter: any): adapter is AgentSdkAdapter {
  return adapter?.kind === "sdk" && typeof adapter.execute === "function";
}

export class DefaultAgentExecutor implements AgentExecutor {
  private readonly config: ResolvedConfig;
  private readonly artifactStore: ArtifactStore;
  private readonly eventBus: EventBus;
  private readonly providerRuntime: ProviderRuntimeMap | undefined;

  constructor(deps: {
    config: ResolvedConfig;
    artifactStore: ArtifactStore;
    eventBus: EventBus;
    providerRuntime?: ProviderRuntimeMap | undefined;
  }) {
    this.config = deps.config;
    this.artifactStore = deps.artifactStore;
    this.eventBus = deps.eventBus;
    this.providerRuntime = deps.providerRuntime;
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    const result = await this.executeInternal(input);
    return removeUndefinedProperties(result);
  }

  private async emitVerboseCommand(input: AgentExecutionInput, details: {
    commandInput?: ProviderCommand | undefined;
    prompt: string;
    artifacts: AgentArtifacts;
    permissions: AgentPermissions;
    metadata?: Record<string, unknown> | undefined;
    secretValues: string[];
    note?: string | undefined;
  }): Promise<void> {
    const payload: AgentVerboseCommandPayload = {
      agentId: input.id,
      label: input.label,
      provider: input.provider,
      model: input.model,
      cwd: input.cwd,
      thinkingEffort: input.thinkingEffort,
      command: details.commandInput
        ? redactProviderCommand(details.commandInput, details.secretValues)
        : undefined,
      prompt: redactText(details.prompt, details.secretValues),
      artifacts: cloneArtifacts(details.artifacts),
      permissions: details.permissions,
      metadata: details.metadata,
      note: details.note
    };
    await this.eventBus.emit("agent.verbose.command", removeUndefinedProperties(payload));
  }

  private async emitVerboseResult(payload: AgentVerboseResultPayload): Promise<void> {
    const snapped = {
      ...payload,
      artifacts: cloneArtifacts(payload.artifacts)
    };
    await this.eventBus.emit("agent.verbose.result", removeUndefinedProperties(snapped));
  }

  private async executeInternal(input: AgentExecutionInput): Promise<AgentResult> {
    const registry = createDefaultProviderRegistry({
      config: this.config,
      providerRuntime: this.providerRuntime
    });
    const adapter = registry.get(input.provider);
    const resolvedPerms = input.permissions || { mode: "default" };
    const sanitizedMetadata = sanitizeMetadata(input.metadata);
    const attachmentMetadata = buildAgentConfigMetadata(input);

    // 1. Write prompt.txt
    await this.artifactStore.writeText(`agents/${input.id}/prompt.txt`, input.prompt);

    // 2. Write schema.json if schema is provided
    if (input.schema) {
      await this.artifactStore.writeJson(`agents/${input.id}/schema.json`, input.schema);
    }

    // Write metadata.json
    const metadataJson: Record<string, any> = {
      ...sanitizedMetadata,
      ...attachmentMetadata,
      model: input.model,
      resolutionSource: sanitizedMetadata.modelResolutionSource || "provider-default",
      structuredOutputTransport: input.schema ? input.structuredOutput?.transport ?? "auto" : undefined,
      permissions: resolvedPerms,
      thinkingEffortResolutionSource: sanitizedMetadata.thinkingEffortResolutionSource || "provider-cli-default"
    };
    if (input.thinkingEffort !== undefined) {
      metadataJson.thinkingEffort = input.thinkingEffort;
    }
    await this.artifactStore.writeJson(`agents/${input.id}/metadata.json`, metadataJson);

    // Write permissions.json
    await this.artifactStore.writeJson(`agents/${input.id}/permissions.json`, resolvedPerms);

    // Initialize empty log files
    await this.artifactStore.writeText(`agents/${input.id}/stdout.log`, "");
    await this.artifactStore.writeText(`agents/${input.id}/stderr.log`, "");

    const secretValues = collectSecretValues(process.env, this.config.security?.redactEnv);

    const stdoutRedactor = new StreamRedactor(secretValues);
    const stderrRedactor = new StreamRedactor(secretValues);

    const startMs = Date.now();
    let stdoutInMemory = "";
    let stderrInMemory = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let cancelled = false;

    const agentArtifacts: AgentArtifacts = {
      dir: `agents/${input.id}`,
      promptPath: `agents/${input.id}/prompt.txt`,
      stdoutPath: `agents/${input.id}/stdout.log`,
      stderrPath: `agents/${input.id}/stderr.log`,
      rawResultPath: `agents/${input.id}/raw-result.json`,
      normalizedResultPath: `agents/${input.id}/normalized-result.json`,
      permissionsPath: `agents/${input.id}/permissions.json`,
      metadataPath: `agents/${input.id}/metadata.json`
    };

    if (input.schema) {
      agentArtifacts.schemaPath = `agents/${input.id}/schema.json`;
    }
    if (input.handoff?.writeTo) {
      agentArtifacts.handoffPath = `agents/${input.id}/handoff.json`;
    }

    // Run input
    const runInput: AgentRunInput = {
      id: input.id,
      label: input.label,
      provider: input.provider,
      prompt: input.prompt,
      model: input.model,
      schema: input.schema,
      structuredOutput: input.structuredOutput,
      timeoutMs: input.timeoutMs,
      cwd: input.cwd,
      env: {},
      permissions: resolvedPerms,
      metadata: input.metadata,
      thinkingEffort: input.thinkingEffort,
      skills: input.skills,
      context: input.context,
      workspace: input.workspace,
      handoff: input.handoff
    };

    const appendToLogs = async (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => {
      const redactedPart = redactor.process(chunk);
      if (redactedPart) {
        if (stream === "stdout") {
          if (stdoutInMemory.length < MAX_IN_MEMORY_LOG_SIZE) {
            stdoutInMemory += redactedPart;
          }
        } else {
          if (stderrInMemory.length < MAX_IN_MEMORY_LOG_SIZE) {
            stderrInMemory += redactedPart;
          }
        }
        await this.artifactStore.appendText(`agents/${input.id}/${stream}.log`, redactedPart);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream, data: redactedPart });
      }
    };

    let executionResult: { exitCode: number | null; timedOut: boolean; cancelled: boolean };
    let commandInput: ProviderCommand | undefined;
    let sdkParsedResult: ProviderParsedResult | undefined;
    try {
      await this.emitAndValidateAgentAttachments(input);
      assertThinkingEffortSupported(input.provider, input.thinkingEffort);
      commandInput = await adapter.buildCommand(runInput);

      const resolvedPrompt = resolveStructuredOutputPrompt({
        prompt: input.prompt,
        schema: input.schema,
        structuredOutput: input.structuredOutput
      }).prompt;

      await this.emitVerboseCommand(input, {
        commandInput,
        prompt: resolvedPrompt,
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata,
        secretValues
      });
    } catch (err: any) {
      // Flush redactors
      const finalStdout = stdoutRedactor.flush();
      if (finalStdout) {
        if (stdoutInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stdoutInMemory += finalStdout;
        await this.artifactStore.appendText(`agents/${input.id}/stdout.log`, finalStdout);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stdout", data: finalStdout });
      }
      const finalStderr = stderrRedactor.flush();
      if (finalStderr) {
        if (stderrInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stderrInMemory += finalStderr;
        await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, finalStderr);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stderr", data: finalStderr });
      }

      const durationMs = Date.now() - startMs;
      const errorPayload = {
        name: err?.name || "Error",
        message: err?.message || String(err),
        code: err?.code || "INTERNAL_ERROR"
      } as any;
      if (err?.stack) {
        errorPayload.stack = err.stack;
      }

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "failed",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        error: redactSerializedError(errorPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errorPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };

      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (input.provider === "mock" && isMockAdapter(adapter)) {
      executionResult = await this.executeMock(input, runInput, adapter, appendToLogs, { stdoutRedactor, stderrRedactor });
    } else if (isSdkAdapter(adapter)) {
      const sdkResult = await this.executeSdk(input, runInput, adapter, appendToLogs, { stdoutRedactor, stderrRedactor });
      executionResult = {
        exitCode: sdkResult.exitCode,
        timedOut: sdkResult.timedOut,
        cancelled: sdkResult.cancelled
      };
      sdkParsedResult = sdkResult.parsed;
    } else {
      executionResult = await this.executeProcess(input, runInput, commandInput, adapter, appendToLogs, { stdoutRedactor, stderrRedactor });
    }

    exitCode = executionResult.exitCode;
    timedOut = executionResult.timedOut;
    cancelled = executionResult.cancelled;

    // Flush redactors
    const finalStdout = stdoutRedactor.flush();
    if (finalStdout) {
      if (stdoutInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stdoutInMemory += finalStdout;
      await this.artifactStore.appendText(`agents/${input.id}/stdout.log`, finalStdout);
      await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stdout", data: finalStdout });
    }
    const finalStderr = stderrRedactor.flush();
    if (finalStderr) {
      if (stderrInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stderrInMemory += finalStderr;
      await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, finalStderr);
      await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stderr", data: finalStderr });
    }

    const durationMs = Date.now() - startMs;

    // Determine success/failure status based on precedence

    if (timedOut) {
      const errPayload = { name: "TimeoutError", message: "Agent execution timed out", code: "PROCESS_TIMEOUT" };

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "timed_out",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        error: redactSerializedError(errPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "timed_out",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (cancelled) {
      const errPayload = { name: "CancelledError", message: "Agent execution was cancelled", code: "USER_CANCELLED" };

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "cancelled",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        error: redactSerializedError(errPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "cancelled",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (exitCode !== null && exitCode !== 0) {
      const errPayload = {
        name: "ProviderProcessFailed",
        message: stderrInMemory.trim() || `Process exited with code ${exitCode}`,
        code: "PROVIDER_PROCESS_FAILED"
      };

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "failed",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        error: redactSerializedError(errPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    let parseResult;
    try {
      parseResult = sdkParsedResult ?? await adapter.parseResult({
        input: runInput,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode
      });
    } catch (err: any) {
      const errPayload = {
        name: "ParseError",
        message: `Parser crashed: ${err.message}`,
        code: "INTERNAL_ERROR" as const
      };
      if (err.stack) {
        (errPayload as any).stack = err.stack;
      }

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "failed",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        error: redactSerializedError(errPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    const rawResult = parseResult.raw ?? parseResult;
    let savedRawResult: any;
    if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
      savedRawResult = {
        ...rawResult,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
    } else {
      savedRawResult = {
        raw: rawResult,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
    }
    await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, savedRawResult);

    const normalized = await normalizeAgentOutput({
      schema: input.schema,
      parsed: parseResult,
      stdout: stdoutInMemory
    });

    if (!normalized.ok) {
      if (normalized.error.errors) {
        agentArtifacts.validationErrorPath = `agents/${input.id}/validation-error.json`;
        await this.artifactStore.writeJson(`agents/${input.id}/validation-error.json`, normalized.error.errors);
      }

      const errPayload = {
        name: "ValidationError",
        message: normalized.error.message,
        code: normalized.error.code as any
      };

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "failed",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        normalized: redactJsonValue({ validation: "failed", errors: normalized.error.errors }, secretValues),
        error: redactSerializedError(errPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata,
        parseWarnings: redactJsonValue(parseResult.parseWarnings, secretValues) as string[]
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
      return failureResult;
    }

    await this.artifactStore.writeJson(`agents/${input.id}/normalized-result.json`, normalized.json ?? normalized.text);

    const handoffCheck = await this.verifyHandoff(input, agentArtifacts);
    if (handoffCheck?.status === "missing-error") {
      const message = handoffCheck.message ?? "Agent handoff file was not created.";
      const errPayload = {
        name: "HandoffMissingError",
        message,
        code: "HANDOFF_MISSING"
      };

      await this.emitVerboseResult({
        agentId: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        status: "failed",
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        normalized: redactJsonValue(normalized.json ?? normalized.text, secretValues),
        error: redactSerializedError(errPayload, secretValues),
        artifacts: agentArtifacts,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata,
        parseWarnings: redactJsonValue(parseResult.parseWarnings, secretValues) as string[]
      });

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms,
        metadata: sanitizedMetadata
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    await this.emitVerboseResult({
      agentId: input.id,
      label: input.label,
      provider: input.provider,
      model: input.model,
      status: "succeeded",
      stdout: stdoutInMemory,
      stderr: stderrInMemory,
      exitCode: exitCode ?? 0,
      durationMs,
      normalized: redactJsonValue(normalized.json ?? normalized.text, secretValues),
      artifacts: agentArtifacts,
      permissions: resolvedPerms,
      metadata: sanitizedMetadata,
      parseWarnings: redactJsonValue(parseResult.parseWarnings, secretValues) as string[]
    });

    const successResult: AgentSuccessResult = {
      ok: true,
      status: "succeeded",
      id: input.id,
      label: input.label,
      provider: input.provider,
      model: input.model,
      text: redactText(normalized.text ?? "", secretValues),
      json: normalized.json,
      stdout: stdoutInMemory,
      stderr: stderrInMemory,
      exitCode: exitCode ?? 0,
      durationMs,
      artifacts: agentArtifacts,
      permissions: resolvedPerms,
      usage: parseResult.usage,
      metadata: sanitizedMetadata
    };

    return successResult;
  }

  private async emitAndValidateAgentAttachments(input: AgentExecutionInput): Promise<void> {
    if (input.skills?.length) {
      for (let index = 0; index < input.skills.length; index += 1) {
        const skillPath = input.skills[index]!;
        await assertReadableWorkspacePath(input.cwd, skillPath, `Skill path does not exist or is not readable: ${skillPath}`);
        await this.eventBus.emit("agent.skill.attached", {
          agentId: input.id,
          path: skillPath,
          index
        });
      }
    }

    const contextFiles = input.context?.files ?? [];
    const contextHandoffs = normalizeHandoffList(input.context?.handoff);
    if (contextFiles.length || contextHandoffs.length || input.context?.notes !== undefined) {
      if (contextFiles.length) {
        for (let index = 0; index < contextFiles.length; index += 1) {
          const filePath = contextFiles[index]!;
          await assertReadableWorkspacePath(input.cwd, filePath, `Context file does not exist or is not readable: ${filePath}`);
          await this.eventBus.emit("agent.context.attached", {
            agentId: input.id,
            kind: "file",
            path: filePath,
            index
          });
        }
      }
      if (contextHandoffs.length) {
        for (let index = 0; index < contextHandoffs.length; index += 1) {
          const handoffPath = contextHandoffs[index]!;
          await assertReadableWorkspacePath(input.cwd, handoffPath, `Context handoff does not exist or is not readable: ${handoffPath}`);
          await this.eventBus.emit("agent.context.attached", {
            agentId: input.id,
            kind: "handoff",
            path: handoffPath,
            index
          });
        }
      }
      if (input.context?.notes !== undefined) {
        await this.eventBus.emit("agent.context.attached", {
          agentId: input.id,
          kind: "notes",
          length: input.context.notes.length
        });
      }
    }
    if (input.handoff?.writeTo) {
      resolveWorkspacePath(input.cwd, input.handoff.writeTo);
    }
  }

  private async verifyHandoff(
    input: AgentExecutionInput,
    artifacts: AgentArtifacts
  ): Promise<{ status: "verified" | "missing-warning" | "missing-error"; message?: string | undefined } | undefined> {
    const handoff = input.handoff;
    if (!handoff || !handoff.writeTo) return undefined;

    const writeTo = handoff.writeTo;
    const required = handoff.required === true;
    const resolvedPath = resolveWorkspacePath(input.cwd, writeTo);
    const exists = await pathExists(resolvedPath);
    const missingMessage = `Agent handoff file was not created: ${writeTo}`;
    const status = exists ? "verified" : required ? "missing-error" : "missing-warning";

    if (!exists) {
      await this.eventBus.emit("agent.handoff.missing", {
        agentId: input.id,
        writeTo,
        required,
        severity: required ? "error" : "warning",
        message: missingMessage
      });
    }

    await this.artifactStore.writeJson(`agents/${input.id}/handoff.json`, {
      writeTo,
      required,
      exists,
      status,
      ...(handoff.instructions !== undefined ? { instructions: handoff.instructions } : {}),
      ...(!exists ? { message: missingMessage } : {})
    });
    artifacts.handoffPath = `agents/${input.id}/handoff.json`;

    return {
      status,
      ...(!exists ? { message: missingMessage } : {})
    };
  }

  private async executeMock(
    input: AgentExecutionInput,
    runInput: AgentRunInput,
    adapter: MockAdapterWithLookup,
    appendToLogs: (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => Promise<void>,
    redactors: { stdoutRedactor: StreamRedactor; stderrRedactor: StreamRedactor }
  ): Promise<{ exitCode: number; timedOut: boolean; cancelled: boolean }> {
    const response = adapter.lookupResponse(runInput);
    let timedOut = false;
    let cancelled = false;

    if (response.delayMs) {
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, response.delayMs);
          input.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          });
        });
      } catch {
        const reason = String(input.signal.reason);
        if (reason.includes("timed out")) {
          timedOut = true;
        } else {
          cancelled = true;
        }
      }
    }

    const mockStdout = response.stdout ?? (response.text ?? "mock response");
    const mockStderr = response.stderr ?? "";
    
    await appendToLogs("stdout", mockStdout, redactors.stdoutRedactor);
    await appendToLogs("stderr", mockStderr, redactors.stderrRedactor);

    return {
      exitCode: response.exitCode !== undefined ? response.exitCode : 0,
      timedOut: timedOut || !!response.timeout,
      cancelled: cancelled || (!!response.fail && response.error?.code === "USER_CANCELLED")
    };
  }

  private async executeProcess(
    input: AgentExecutionInput,
    runInput: AgentRunInput,
    commandInput: any,
    adapter: any,
    appendToLogs: (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => Promise<void>,
    redactors: { stdoutRedactor: StreamRedactor; stderrRedactor: StreamRedactor }
  ): Promise<{ exitCode: number | null; timedOut: boolean; cancelled: boolean }> {
    try {
      const filteredEnv = buildProviderEnv({
        baseEnv: process.env,
        passEnv: this.config.security?.passEnv ?? [],
        explicitEnv: commandInput.env
      });
      const processResult = await runProcess({
        command: commandInput.command,
        args: commandInput.args,
        cwd: commandInput.cwd,
        ...(commandInput.stdin !== undefined ? { stdin: commandInput.stdin } : {}),
        env: filteredEnv,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        onStdout: async (chunk) => {
          await appendToLogs("stdout", chunk, redactors.stdoutRedactor);
        },
        onStderr: async (chunk) => {
          await appendToLogs("stderr", chunk, redactors.stderrRedactor);
        }
      });
      return processResult;
    } catch (err: any) {
      if (err.message?.includes("timeout") || err.code === "PROCESS_TIMEOUT") {
        return { exitCode: null, timedOut: true, cancelled: false };
      } else if (err.name === "AbortError" || input.signal?.aborted) {
        return { exitCode: null, timedOut: false, cancelled: true };
      } else {
        const errorMsg = `\nError running process: ${err.message}`;
        await appendToLogs("stderr", errorMsg, redactors.stderrRedactor);
        return { exitCode: 1, timedOut: false, cancelled: false };
      }
    }
  }

  private async executeSdk(
    input: AgentExecutionInput,
    runInput: AgentRunInput,
    adapter: AgentSdkAdapter,
    appendToLogs: (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => Promise<void>,
    redactors: { stdoutRedactor: StreamRedactor; stderrRedactor: StreamRedactor }
  ): Promise<{
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    parsed?: ProviderParsedResult | undefined;
  }> {
    try {
      const result = await adapter.execute(runInput, {
        signal: input.signal,
        emitOutput: async (stream, data) => {
          await appendToLogs(stream, data, stream === "stdout" ? redactors.stdoutRedactor : redactors.stderrRedactor);
        }
      });
      if (result.stdout) {
        await appendToLogs("stdout", result.stdout, redactors.stdoutRedactor);
      }
      if (result.stderr) {
        await appendToLogs("stderr", result.stderr, redactors.stderrRedactor);
      }
      return {
        exitCode: result.exitCode ?? 0,
        timedOut: result.timedOut === true,
        cancelled: result.cancelled === true,
        parsed: result.parsed
      };
    } catch (err: any) {
      const errorMsg = `\nSDK provider failed: ${err?.message ?? String(err)}`;
      await appendToLogs("stderr", errorMsg, redactors.stderrRedactor);
      if (err?.message?.includes("timeout") || err?.code === "PROCESS_TIMEOUT") {
        return { exitCode: null, timedOut: true, cancelled: false };
      }
      if (err?.name === "AbortError" || input.signal?.aborted) {
        return { exitCode: null, timedOut: false, cancelled: true };
      }
      return { exitCode: 1, timedOut: false, cancelled: false };
    }
  }
}

function removeUndefinedProperties<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (obj instanceof Date || obj instanceof RegExp || obj instanceof Promise) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedProperties) as any;
  }
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== undefined) {
      result[key] = removeUndefinedProperties(val);
    }
  }
  return result;
}

function normalizeHandoffList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function buildAgentConfigMetadata(input: AgentExecutionInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (input.workspace) {
    metadata.workspace = {
      cwd: input.workspace.cwd,
      mode: input.workspace.mode
    };
  }

  if (input.skills?.length) {
    metadata.skills = input.skills.map((skillPath) => ({ path: skillPath }));
  }

  const contextFiles = input.context?.files ?? [];
  const contextHandoffs = normalizeHandoffList(input.context?.handoff);
  if (contextFiles.length || contextHandoffs.length || input.context?.notes !== undefined) {
    metadata.context = {
      ...(contextFiles.length ? { files: [...contextFiles] } : {}),
      ...(contextHandoffs.length ? { handoff: [...contextHandoffs] } : {}),
      ...(input.context?.notes !== undefined ? {
        notes: {
          present: true,
          length: input.context.notes.length
        }
      } : {})
    };
  }

  if (input.handoff) {
    metadata.handoff = {
      ...(input.handoff.writeTo !== undefined ? { writeTo: input.handoff.writeTo } : {}),
      ...(input.handoff.instructions !== undefined ? { instructions: input.handoff.instructions } : {}),
      required: input.handoff.required === true
    };
  }

  return metadata;
}

function resolveWorkspacePath(cwd: string, candidate: string): string {
  const root = path.resolve(cwd);
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, `Path escapes agent workspace: ${candidate}`);
}

async function assertReadablePath(filePath: string, message: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, message);
  }
}

async function assertReadableWorkspacePath(cwd: string, candidate: string, message: string): Promise<string> {
  const resolved = resolveWorkspacePath(cwd, candidate);
  await assertReadablePath(resolved, message);
  const rootRealPath = await fs.realpath(path.resolve(cwd));
  const fileRealPath = await fs.realpath(resolved);
  const relative = path.relative(rootRealPath, fileRealPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, `Path escapes agent workspace: ${candidate}`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cloneArtifacts(artifacts: AgentArtifacts): AgentArtifacts {
  return { ...artifacts };
}
