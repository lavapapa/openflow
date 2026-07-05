import type { AgentResult, AgentUsage, AgentUsageSummary } from "./types/agent.js";

export function summarizeAgentUsage(results: AgentResult[]): AgentUsageSummary | undefined {
  const summary: AgentUsageSummary = {
    agentCount: 0,
    totalAgentCount: results.length,
    splitUsageAgentCount: 0,
    totalOnlyUsageAgentCount: 0,
    missingUsageAgentCount: 0
  };

  for (const result of results) {
    if (!hasReportedUsage(result.usage)) {
      summary.missingUsageAgentCount = (summary.missingUsageAgentCount ?? 0) + 1;
      continue;
    }
    summary.agentCount += 1;
    if (hasSplitUsage(result.usage)) {
      summary.splitUsageAgentCount = (summary.splitUsageAgentCount ?? 0) + 1;
    } else if (result.usage.totalTokens !== undefined) {
      summary.totalOnlyUsageAgentCount = (summary.totalOnlyUsageAgentCount ?? 0) + 1;
    }
    addUsage(summary, result.usage);
  }

  return summary.agentCount > 0 ? summary : undefined;
}

function hasReportedUsage(usage: AgentUsage | undefined): usage is AgentUsage {
  return usage !== undefined && (
    usage.inputTokens !== undefined ||
    usage.cachedInputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.reasoningOutputTokens !== undefined ||
    usage.totalTokens !== undefined
  );
}

function hasSplitUsage(usage: AgentUsage): boolean {
  return usage.inputTokens !== undefined ||
    usage.cachedInputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.reasoningOutputTokens !== undefined;
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
