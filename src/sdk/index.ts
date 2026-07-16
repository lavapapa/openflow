import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EventEnvelope } from "../output/events.js";
import type { EventSubscriber } from "../orchestration/event-bus.js";
import type { JsonObject, ProviderName } from "../types/common.js";
import type { ProviderConfig } from "../config/types.js";
import type { ProviderRuntimeMap } from "../agents/registry.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import { defaultRunsDir } from "../artifacts/run-store.js";
import { prepareWorkflowRun, readRunJson } from "../runtime/run-service.js";

export type OpenFlowEvent = EventEnvelope;

export interface OpenFlowClientOptions {
  workspace: {
    cwd: string;
    runsDir?: string | undefined;
    worktreesDir?: string | undefined;
  };
  configPath?: string | undefined;
  providerRuntime?: ProviderRuntimeMap | undefined;
}

export type WorkflowInput =
  | { kind: "name"; name: string }
  | { kind: "file"; path: string };

export interface ProviderOverride extends Partial<ProviderConfig> {}

export interface RunInput {
  workflow: WorkflowInput;
  args?: JsonObject | undefined;
  defaultProvider?: ProviderName | undefined;
  model?: string | undefined;
  providers?: Record<string, ProviderOverride> | undefined;
  providerRuntime?: ProviderRuntimeMap | undefined;
  concurrency?: number | undefined;
  timeoutMs?: number | undefined;
  maxAgentCalls?: number | undefined;
  failFast?: boolean | undefined;
  cache?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export type RunLocator =
  | { runId: string }
  | { path: string };

export interface ResumeInput {
  from: RunLocator;
  defaultProvider?: ProviderName | undefined;
  model?: string | undefined;
  providers?: Record<string, ProviderOverride> | undefined;
  providerRuntime?: ProviderRuntimeMap | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunHandle<TResult = unknown> {
  runId: string;
  resumedFromRunId?: string | undefined;
  artifactsDir: string;
  events: AsyncIterable<OpenFlowEvent>;
  result: Promise<WorkflowRunResult & { result?: TResult | undefined }>;
  abort(reason?: string): void;
}

export interface RunInspection<TResult = unknown> {
  runId: string;
  path: string;
  manifest?: unknown;
  report?: (WorkflowRunResult & { result?: TResult | undefined }) | undefined;
}

export interface RunListItem {
  runId: string;
  path: string;
  status?: string | undefined;
  updatedAt?: string | undefined;
}

export interface ListRunsQuery {
  limit?: number | undefined;
}

export interface OpenFlowClient {
  run<TResult = unknown>(input: RunInput): Promise<RunHandle<TResult>>;
  resume<TResult = unknown>(input: ResumeInput): Promise<RunHandle<TResult>>;
  inspectRun<TResult = unknown>(run: RunLocator): Promise<RunInspection<TResult>>;
  listRuns(query?: ListRunsQuery): Promise<RunListItem[]>;
}

class AsyncEventStream implements EventSubscriber, AsyncIterable<OpenFlowEvent> {
  private readonly queue: OpenFlowEvent[] = [];
  private readonly waiters: Array<{
    resolve(value: IteratorResult<OpenFlowEvent>): void;
    reject(reason?: unknown): void;
  }> = [];
  private closed = false;
  private error: unknown;

  handle(event: EventEnvelope): void {
    if (this.closed) return;
    const typedEvent = event as OpenFlowEvent;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: typedEvent, done: false });
    } else {
      this.queue.push(typedEvent);
    }
    if (isTerminalEvent(typedEvent.type)) {
      this.close();
    }
  }

  close(error?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.error = error;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<OpenFlowEvent> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.error) {
          return Promise.reject(this.error);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<OpenFlowEvent>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      }
    };
  }
}

export function createOpenFlow(options: OpenFlowClientOptions): OpenFlowClient {
  const cwd = path.resolve(options.workspace.cwd);
  const runsDir = options.workspace.runsDir
    ? path.resolve(cwd, options.workspace.runsDir)
    : defaultRunsDir(cwd);

  const runInternal = async <TResult>(input: RunInput & {
    workflowTarget: string;
    resume?: string | undefined;
    resumedFromRunId?: string | undefined;
  }): Promise<RunHandle<TResult>> => {
    const events = new AsyncEventStream();
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

    const prepared = await prepareWorkflowRun({
      workflowTarget: input.workflowTarget,
      cwd,
      configPath: options.configPath,
      runsDir,
      worktreesDir: options.workspace.worktreesDir,
      args: input.args,
      defaultProvider: input.defaultProvider,
      model: input.model,
      providers: input.providers,
      providerRuntime: input.providerRuntime ?? options.providerRuntime,
      concurrency: input.concurrency,
      timeoutMs: input.timeoutMs,
      maxAgentCalls: input.maxAgentCalls,
      failFast: input.failFast,
      noCache: input.cache === false,
      resume: input.resume,
      signal: abortController.signal,
      subscribers: [events]
    });

    const result = prepared.execute()
      .catch((err) => {
        events.close(err);
        throw err;
      })
      .finally(() => {
        events.close();
      }) as Promise<WorkflowRunResult & { result?: TResult | undefined }>;

    return {
      runId: prepared.runId,
      resumedFromRunId: input.resumedFromRunId,
      artifactsDir: prepared.artifactsDir,
      events,
      result,
      abort: (reason?: string) => {
        abortController.abort(reason || "Run aborted by SDK caller.");
        prepared.abortController.abort(reason || "Run aborted by SDK caller.");
      }
    };
  };

  return {
    run: async (input) => runInternal({
      ...input,
      workflowTarget: resolveWorkflowInput(cwd, input.workflow)
    }),
    resume: async (input) => {
      const previousRunRoot = resolveRunRoot(input.from, runsDir);
      const runInput = await readRunJson(previousRunRoot, "run-input.json") as any;
      const workflowFile = typeof runInput?.workflowFile === "string" ? runInput.workflowFile : undefined;
      const previousRunId = typeof runInput?.runId === "string" ? runInput.runId : path.basename(previousRunRoot);
      if (!workflowFile) {
        throw new Error(`Cannot resume OpenFlow run without run-input workflowFile: ${previousRunRoot}`);
      }
      return runInternal({
        workflow: { kind: "file", path: workflowFile },
        workflowTarget: workflowFile,
        args: isJsonObject(runInput?.sdkArgs) ? runInput.sdkArgs : undefined,
        defaultProvider: input.defaultProvider,
        model: input.model,
        providers: input.providers,
        providerRuntime: input.providerRuntime ?? options.providerRuntime,
        resume: previousRunRoot,
        signal: input.signal,
        resumedFromRunId: previousRunId
      });
    },
    inspectRun: async (run) => {
      const root = resolveRunRoot(run, runsDir);
      return {
        runId: path.basename(root),
        path: root,
        manifest: await readRunJson(root, "manifest.json"),
        report: await readRunJson(root, "report.json") as any
      };
    },
    listRuns: async (query = {}) => {
      let entries: Array<{ name: string; path: string; updatedAt?: string | undefined; status?: string | undefined }> = [];
      try {
        const dirs = await fs.readdir(runsDir, { withFileTypes: true });
        entries = await Promise.all(dirs.filter((dirent) => dirent.isDirectory()).map(async (dirent) => {
          const runPath = path.join(runsDir, dirent.name);
          const manifest = await readRunJson(runPath, "manifest.json") as any;
          return {
            name: dirent.name,
            path: runPath,
            updatedAt: typeof manifest?.updatedAt === "string" ? manifest.updatedAt : undefined,
            status: typeof manifest?.status === "string" ? manifest.status : undefined
          };
        }));
      } catch {
        return [];
      }
      return entries
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
        .slice(0, query.limit ?? 50)
        .map((entry) => ({
          runId: entry.name,
          path: entry.path,
          status: entry.status,
          updatedAt: entry.updatedAt
        }));
    }
  };
}

function resolveWorkflowInput(cwd: string, workflow: WorkflowInput): string {
  if (workflow.kind === "name") return workflow.name;
  return path.isAbsolute(workflow.path) ? workflow.path : path.resolve(cwd, workflow.path);
}

function resolveRunRoot(locator: RunLocator, runsDir: string): string {
  if ("path" in locator) return path.resolve(locator.path);
  return path.resolve(runsDir, locator.runId);
}

function isTerminalEvent(type: string): boolean {
  return type === "workflow.completed" || type === "workflow.failed" || type === "workflow.cancelled";
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
