import { describe, expect, it } from "vitest";
import { summarizeAgentUsage } from "../../src/usage.js";
import type { AgentResult, AgentUsage } from "../../src/types/agent.js";

describe("summarizeAgentUsage", () => {
  it("returns undefined when no agent reported usage", () => {
    expect(summarizeAgentUsage([
      agentResult("missing"),
    ])).toBeUndefined();
  });

  it("aggregates usage and reports coverage for split, total-only, and missing agents", () => {
    expect(summarizeAgentUsage([
      agentResult("split-a", { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4 }),
      agentResult("total-only", { totalTokens: 30 }),
      agentResult("split-b", { inputTokens: 5, outputTokens: 3, totalTokens: 20 }),
      agentResult("missing"),
    ])).toEqual({
      agentCount: 3,
      totalAgentCount: 4,
      splitUsageAgentCount: 2,
      totalOnlyUsageAgentCount: 1,
      missingUsageAgentCount: 1,
      inputTokens: 15,
      cachedInputTokens: 2,
      outputTokens: 7,
      totalTokens: 64,
    });
  });
});

function agentResult(id: string, usage?: AgentUsage): AgentResult {
  return {
    ok: true,
    status: "succeeded",
    id,
    provider: "mock",
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
    artifacts: {},
    permissions: { mode: "default" },
    ...(usage ? { usage } : {}),
  };
}
