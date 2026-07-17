/**
 * Sanitizes metadata for external exposure in events, reports, and artifacts.
 * This prevents sensitive data or excessive volume from leaking while preserving
 * essential shared-agent and pipeline context.
 */
export function sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const safeFields = new Set([
    "sharedAgentId",
    "sharedAgentSource",
    "pipelineId",
    "pipelineLabel",
    "itemIndex",
    "stageIndex",
    "stageName",
    "modelResolutionSource",
    "thinkingEffort",
    "thinkingEffortResolutionSource",
    "workspaceMode",
    "workspaceKey",
    "workspaceRef",
    "workspaceRetention",
    "skillCount",
    "contextFileCount",
    "contextHandoffCount",
    "handoffRequired",
    "handoffWriteTo",
  ]);

  const MAX_STRING_LENGTH = 256;
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // `audit.*` 是调用方显式声明为可公开、可持久化的审计字段；其余自定义字段仍默认丢弃。
    if (!safeFields.has(key) && !key.startsWith("audit.")) {
      continue;
    }

    if (typeof value === "string") {
      sanitized[key] = value.length > MAX_STRING_LENGTH 
        ? value.substring(0, MAX_STRING_LENGTH) + "..." 
        : value;
    } else if (typeof value === "boolean") {
      sanitized[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    }
    // Objects and arrays are dropped as per requirements
  }

  return sanitized;
}
