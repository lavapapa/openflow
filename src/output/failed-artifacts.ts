import * as path from "path";
import type { PrettyFailureRecord } from "./pretty-view.js";

/**
 * Resolves the most useful failure artifact paths for display in the pretty reporter.
 */
export function resolveFailedSubpaths(
  runRootDir: string,
  failureRecords: PrettyFailureRecord[],
  maxEntries: number = 5
): string[] {
  const subpaths: string[] = [];

  for (const record of failureRecords) {
    const candidates: (string | undefined)[] = [];

    if (record.kind === "agent") {
      // Priority: validation-error.json, stderr.log, agent directory
      if (record.failureKind === "schema") {
        candidates.push(record.specificFailureSubpath || (record.artifactSubpath ? path.join(record.artifactSubpath, "validation-error.json") : "validation-error.json"));
      } else if (record.failureKind === "provider" || record.failureKind === "process" || record.failureKind === "timeout") {
        candidates.push(record.specificFailureSubpath || (record.artifactSubpath ? path.join(record.artifactSubpath, "stderr.log") : "stderr.log"));
      }
      candidates.push(record.artifactSubpath);
    } else if (record.kind === "workflow") {
      // Priority: error.json, workflow directory
      candidates.push(record.specificFailureSubpath || (record.artifactSubpath ? path.join(record.artifactSubpath, "error.json") : "error.json"));
      candidates.push(record.artifactSubpath);
    } else if (record.kind === "tool") {
      // Priority: error.json, tool directory
      candidates.push(record.specificFailureSubpath || (record.artifactSubpath ? path.join(record.artifactSubpath, "error.json") : "error.json"));
      candidates.push(record.artifactSubpath);
    } else if (record.kind === "pipeline") {
      // Priority: known pipeline artifact path
      candidates.push(record.artifactSubpath);
    } else if (record.kind === "loop") {
      // Priority: error.json, loop directory
      candidates.push(record.specificFailureSubpath || (record.artifactSubpath ? path.join(record.artifactSubpath, "error.json") : "error.json"));
      candidates.push(record.artifactSubpath);
    }

    for (const candidate of candidates) {
      if (!candidate) continue;

      // Normalize candidate path
      const absoluteRunRoot = path.resolve(runRootDir);
      const absoluteCandidate = path.resolve(runRootDir, candidate);
      const relativePath = path.relative(absoluteRunRoot, absoluteCandidate);

      const isInside = relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
      
      if (!isInside) {
        // Skip if outside root or exactly the root
        continue;
      }

      // Skip common paths that are already displayed separately
      if (["", ".", "run", "report.json", "events.jsonl"].includes(relativePath)) continue;

      if (!subpaths.includes(relativePath)) {
        subpaths.push(relativePath);
      }
    }
  }

  // Deduplicate and filter out empty
  const uniqueSubpaths = Array.from(new Set(subpaths)).filter(Boolean);

  if (uniqueSubpaths.length > maxEntries) {
    const result = uniqueSubpaths.slice(0, maxEntries);
    result.push(`... and ${uniqueSubpaths.length - maxEntries} more`);
    return result;
  }

  return uniqueSubpaths;
}
