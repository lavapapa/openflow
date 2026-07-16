import * as os from "node:os";
import * as path from "node:path";
import { DefaultAgentExecutor } from "../agents/execute-agent.js";
import type { ProviderRuntimeMap } from "../agents/registry.js";
import type { EventBus } from "../orchestration/event-bus.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { GitWorktreeManager } from "../workspaces/index.js";

export interface CreateDefaultAgentExecutorInput {
  config: ConstructorParameters<typeof DefaultAgentExecutor>[0]["config"];
  artifactStore: ArtifactStore;
  eventBus: EventBus;
  providerRuntime?: ProviderRuntimeMap | undefined;
  runId: string;
  cwd: string;
  worktreesDir?: string | undefined;
}

/**
 * Agent execution is composed here so CLI and SDK use the same workspace
 * lifecycle instead of constructing infrastructure in business code.
 */
export function createDefaultAgentExecutor(input: CreateDefaultAgentExecutorInput): DefaultAgentExecutor {
  const rootDir = input.worktreesDir
    ? path.resolve(input.cwd, input.worktreesDir)
    : path.join(os.homedir(), ".open-dynamic-workflow", "worktrees");

  return new DefaultAgentExecutor({
    config: input.config,
    artifactStore: input.artifactStore,
    eventBus: input.eventBus,
    providerRuntime: input.providerRuntime,
    workspaceManager: new GitWorktreeManager({
      rootDir,
      allowedRepositories: [input.cwd]
    }),
    workspaceNamespace: input.runId
  });
}
