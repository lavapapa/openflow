import type { AgentResult, AgentUsage, AgentUsageSummary } from "./types/agent.js";

export function summarizeAgentUsage(results: AgentResult[]): AgentUsageSummary | undefined {
  const summary: AgentUsageSummary = { agentCount: 0 };

  for (const result of results) {
    if (!result.usage) continue;
    summary.agentCount += 1;
    addUsage(summary, result.usage);
  }

  return summary.agentCount > 0 ? summary : undefined;
}

function addUsage(summary: AgentUsageSummary, usage: AgentUsage): void {
  addNumber(summary, "inputTokens", usage.inputTokens);
  addNumber(summary, "cachedInputTokens", usage.cachedInputTokens);
  addNumber(summary, "outputTokens", usage.outputTokens);
  addNumber(summary, "reasoningOutputTokens", usage.reasoningOutputTokens);

  if (usage.totalTokens !== undefined) {
    addNumber(summary, "totalTokens", usage.totalTokens);
  } else if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    addNumber(summary, "totalTokens", (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  }
}

function addNumber(summary: AgentUsageSummary, key: keyof AgentUsage, value: number | undefined): void {
  if (value === undefined) return;
  summary[key] = (summary[key] ?? 0) + value;
}
