import type { PrettyStatus, StatusCounts } from "./pretty-view.js";

/**
 * Formats duration in milliseconds to a human-readable string.
 * Examples:
 * - 36700 -> 36.7s
 * - 72300 -> 1m 12.3s
 * - 3849200 -> 1h 04m 09.2s
 */
export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "";
  
  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - totalMinutes * 60;

  if (totalMinutes < 60) {
    return `${totalMinutes}m ${seconds.toFixed(1).padStart(4, "0")}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${seconds.toFixed(1).padStart(4, "0")}s`;
}

/**
 * Returns a status marker (icon) for the given status.
 */
export function getStatusMarker(status: PrettyStatus): string {
  switch (status) {
    case "succeeded":
      return "✓";
    case "failed":
      return "✕";
    case "timed_out":
      return "⏱";
    case "cancelled":
      return "⏹";
    case "running":
      return "▶";
    case "queued":
      return "○";
    case "skipped":
      return "-";
    default:
      return "?";
  }
}

/**
 * Formats a permission label.
 * "dangerously-full-access" -> "⚠ full-access"
 * "workspace-full-access" -> "workspace-only"
 */
export function formatPermission(mode?: string): string {
  if (!mode) return "";
  if (mode === "dangerously-full-access") {
    return "⚠ full-access";
  }
  if (mode === "workspace-full-access") {
    return "workspace-only";
  }
  return mode;
}

export function formatStatusCounts(counts: StatusCounts): string {
  const parts: string[] = [];
  if (counts.succeeded > 0) parts.push(`${counts.succeeded} succeeded`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.timed_out > 0) parts.push(`${counts.timed_out} timed out`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  
  if (parts.length === 0) return "0";
  return parts.join(", ");
}
