import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EventSubscriber } from "../orchestration/event-bus.js";
import { EventBus } from "../orchestration/event-bus.js";
import { FileSystemArtifactStore } from "../artifacts/run-store.js";
import { loadConfig } from "../config/load.js";
import type { ConfigCliOverrides } from "../config/merge.js";
import type { ProviderConfig } from "../config/types.js";
import { discoverWorkflowRegistry } from "../workflow/discovery.js";
import { resolveWorkflowTarget } from "../workflow/resolve-target.js";
import type { ResolvedWorkflowIdentity, WorkflowIdentity, WorkflowRunResult } from "../types/workflow.js";
import type { JsonObject, ProviderName, ReporterMode } from "../types/common.js";
import { DefaultRuntimeRunner, type RuntimeRunner } from "./public.js";
import { loadSharedAgentRegistry } from "../shared-agents/load.js";
import { loadToolRegistry } from "../tools/load.js";
import { DefaultToolExecutor } from "../tools/executor.js";
import { collectSecretValues } from "../security/env.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { ProviderRuntimeMap } from "../agents/registry.js";
import { createDefaultAgentExecutor } from "./create-agent-executor.js";

export interface RunServiceInput {
  workflowTarget: string;
  cwd: string;
  configPath?: string | undefined;
  runsDir?: string | undefined;
  worktreesDir?: string | undefined;
  args?: JsonObject | undefined;
  defaultProvider?: ProviderName | undefined;
  model?: string | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  providers?: Record<string, Partial<ProviderConfig>> | undefined;
  providerRuntime?: ProviderRuntimeMap | undefined;
  concurrency?: number | undefined;
  timeoutMs?: number | undefined;
  maxAgentCalls?: number | undefined;
  report?: ReporterMode | undefined;
  failFast?: boolean | undefined;
  verbose?: boolean | undefined;
  resume?: string | undefined;
  noCache?: boolean | undefined;
  signal?: AbortSignal | undefined;
  subscribers?: EventSubscriber[] | undefined;
  runtimeRunner?: RuntimeRunner | undefined;
  originalRequestedTarget?: string | undefined;
  originalTargetKind?: "workflow-name" | "workflow-file" | undefined;
  originalWorkflowName?: string | undefined;
}

export interface PreparedWorkflowRun {
  runId: string;
  artifactsDir: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  workflow: WorkflowIdentity;
  eventBus: EventBus;
  artifactStore: FileSystemArtifactStore;
  abortController: AbortController;
  execute(): Promise<WorkflowRunResult>;
}

export async function prepareWorkflowRun(input: RunServiceInput): Promise<PreparedWorkflowRun> {
  const cliOverrides: ConfigCliOverrides = {};
  if (input.defaultProvider !== undefined) cliOverrides.provider = input.defaultProvider;
  if (input.model !== undefined) cliOverrides.model = input.model;
  if (input.concurrency !== undefined) cliOverrides.concurrency = input.concurrency;
  if (input.timeoutMs !== undefined) cliOverrides.timeoutMs = input.timeoutMs;
  if (input.maxAgentCalls !== undefined) cliOverrides.maxAgentCalls = input.maxAgentCalls;
  if (input.report !== undefined) cliOverrides.report = input.report;
  if (input.verbose !== undefined) cliOverrides.verbose = input.verbose;

  let config = await loadConfig({
    cwd: input.cwd,
    ...(input.configPath !== undefined ? { configPath: input.configPath } : {}),
    ...(input.runsDir !== undefined ? { outDir: input.runsDir } : {}),
    cli: cliOverrides
  });

  if (input.providers) {
    config = {
      ...config,
      providers: {
        ...config.providers
      }
    };
    for (const [name, providerPatch] of Object.entries(input.providers)) {
      config.providers[name] = {
        ...(config.providers[name] ?? {}),
        ...providerPatch
      } as ProviderConfig;
    }
  }

  const resolved = await resolveWorkflowTarget({
    target: input.workflowTarget,
    cwd: config.cwd,
    config,
    mode: "run"
  });

  if (input.originalRequestedTarget) resolved.requestedTarget = input.originalRequestedTarget;
  if (input.originalTargetKind) resolved.targetKind = input.originalTargetKind;
  if (input.originalWorkflowName) resolved.workflowName = input.originalWorkflowName;

  const sharedAgentRegistry = await loadSharedAgentRegistry({
    cwd: config.cwd,
    dir: config.sharedAgents?.dir,
    maxDefinitions: config.sharedAgents?.maxDefinitions,
    strictPromptTemplateVariables: config.sharedAgents?.strictPromptTemplateVariables
  });

  const toolRegistry = await loadToolRegistry({
    cwd: config.cwd,
    dir: config.tools?.dir,
    maxDefinitions: config.tools?.maxDefinitions ?? 100
  });

  const workflowRegistry = await discoverWorkflowRegistry({
    rootWorkflowPath: resolved.workflowFile,
    cwd: config.cwd,
    include: config.workflow.discovery.include,
    candidatePaths: resolved.candidatePaths,
    sharedAgentRegistry,
    toolRegistry,
    allowDynamicSharedAgentIds: config.sharedAgents?.allowDynamicIds,
    maxLoopRounds: config.workflow.maxLoopRounds
  });

  const absoluteRootPath = path.resolve(config.cwd, resolved.workflowFile);
  const rootDefinition = workflowRegistry.list().find((definition) => definition.sourcePath === absoluteRootPath);
  if (!rootDefinition) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND,
      `Root workflow definition not found in discovery: ${absoluteRootPath}`
    );
  }

  const runId = crypto.randomUUID();
  const runOutDir = path.join(config.outDir, runId);
  const artifactStore = new FileSystemArtifactStore({ rootDir: config.outDir });

  const workflowIdentity: WorkflowIdentity = {
    name: input.originalWorkflowName || resolved.workflowName,
    file: resolved.workflowFileRelative,
    requestedTarget: input.originalRequestedTarget || resolved.requestedTarget,
    targetKind: input.originalTargetKind || resolved.targetKind
  };

  const runtimeWorkflowIdentity: ResolvedWorkflowIdentity = {
    name: workflowIdentity.name,
    file: workflowIdentity.file,
    requestedTarget: workflowIdentity.requestedTarget,
    targetKind: workflowIdentity.targetKind,
    workflowFile: resolved.workflowFile,
    workflowFileRelative: resolved.workflowFileRelative,
    discoverySource: resolved.discoverySource
  };

  await artifactStore.createRun({
    runId,
    outDir: runOutDir,
    workflowPath: resolved.workflowFile,
    workflowSource: rootDefinition.parsedWorkflow.sourceText || "",
    workflowHash: rootDefinition.parsedWorkflow.sourceHash,
    workflow: workflowIdentity,
    resolvedConfig: config,
    openDynamicWorkflowVersion: rootDefinition.parsedWorkflow.meta.version || "0.0.0",
    cwd: config.cwd,
    configPath: config.configPath
  });

  await artifactStore.writeJson("run-input.json", {
    schemaVersion: "open-dynamic-workflow.run-input.v1",
    runId,
    workflowFile: resolved.workflowFile,
    requestedTarget: resolved.requestedTarget,
    targetKind: resolved.targetKind,
    workflowName: resolved.workflowName,
    cwd: config.cwd,
    outDir: config.outDir,
    configPath: config.configPath,
    sdkArgs: input.args ?? {},
    rawOptions: {
      provider: input.defaultProvider,
      model: input.model,
      thinkingEffort: input.thinkingEffort,
      arg: Object.entries(input.args ?? {}).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`),
      config: config.configPath,
      cwd: config.cwd,
      out: config.outDir,
      worktreesDir: input.worktreesDir,
      report: input.report,
      concurrency: input.concurrency,
      timeoutMs: input.timeoutMs,
      maxAgentCalls: input.maxAgentCalls,
      resume: input.resume,
      noCache: input.noCache,
      failFast: !!input.failFast,
      verbose: !!input.verbose
    }
  });

  const eventBus = new EventBus({
    runId,
    artifactStore,
    ...(input.subscribers !== undefined ? { subscribers: input.subscribers } : {})
  });

  const agentExecutor = createDefaultAgentExecutor({
    config: config as any,
    artifactStore,
    eventBus,
    providerRuntime: input.providerRuntime,
    runId,
    cwd: config.cwd,
    worktreesDir: input.worktreesDir
  });

  const abortController = new AbortController();
  if (input.signal) {
    if (input.signal.aborted) {
      abortController.abort(input.signal.reason || "External cancellation");
    } else {
      input.signal.addEventListener("abort", () => {
        abortController.abort(input.signal?.reason || "External cancellation");
      }, { once: true });
    }
  }

  const toolExecutor = new DefaultToolExecutor({
    concurrency: config.tools?.concurrency ?? 1,
    eventSink: eventBus,
    artifactStore,
    runArtifacts: artifactStore.getRunArtifacts(),
    runId,
    cwd: config.cwd,
    rootSignal: abortController.signal,
    redactedSecrets: collectSecretValues(process.env, config.security?.redactEnv)
  });

  const runner = input.runtimeRunner ?? new DefaultRuntimeRunner();
  const args = input.args ?? {};

  return {
    runId,
    artifactsDir: runOutDir,
    config,
    workflow: workflowIdentity,
    eventBus,
    artifactStore,
    abortController,
    async execute() {
      const result = await runner.run({
        parsedWorkflow: rootDefinition.parsedWorkflow,
        workflowRegistry,
        workflowIdentity: runtimeWorkflowIdentity,
        config: config as any,
        cli: {
          workflowFile: rootDefinition.sourcePath,
          ...(input.defaultProvider !== undefined ? { provider: input.defaultProvider } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          args,
          cwd: config.cwd,
          outDir: runOutDir,
          report: config.reporting.mode,
          concurrency: config.concurrency,
          timeoutMs: config.timeoutMs,
          ...(config.maxAgentCalls !== undefined ? { maxAgentCalls: config.maxAgentCalls } : {}),
          ...(input.resume !== undefined ? { resume: input.resume } : {}),
          noCache: !!input.noCache,
          dryRun: false,
          failFast: !!input.failFast,
          verbose: config.reporting.verbose,
          ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {})
        },
        signal: abortController.signal,
        sharedAgentRegistry,
        toolRegistry
      }, (() => {
        let pipelineCounter = 0;
        return {
          agentExecutor,
          eventSink: eventBus,
          artifactStore,
          toolExecutor,
          idGenerator: {
            nextId: (prefix: string) => {
              if (prefix === "run") return runId;
              if (prefix === "pipeline") {
                pipelineCounter += 1;
                return `pipeline-${pipelineCounter}`;
              }
              return crypto.randomUUID();
            }
          }
        };
      })());

      await eventBus.drain();
      result.workflow = workflowIdentity;
      if (artifactStore.isRunCreated()) {
        await artifactStore.writeFinalReport(result);
      }
      return result;
    }
  };
}

export async function readRunJson(root: string, fileName: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, fileName), "utf8"));
  } catch {
    return undefined;
  }
}
