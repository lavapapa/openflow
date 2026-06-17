import { InvalidDslCallError } from "../workflow/errors.js";

const ID_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/**
 * Creates a stable loop identifier.
 */
export function createLoopId(sequence: number): string {
  if (typeof sequence !== "number" || sequence < 1 || isNaN(sequence)) {
    throw new InvalidDslCallError("Loop sequence must be a positive integer.");
  }
  return `loop-${sequence}`;
}

/**
 * Creates a stable round identifier.
 */
export function createRoundId(loopId: string, roundIndex: number): string {
  if (!loopId || typeof loopId !== "string") {
    throw new InvalidDslCallError("createRoundId: loopId is required and must be a string.");
  }
  if (typeof roundIndex !== "number" || roundIndex < 1 || isNaN(roundIndex)) {
    throw new InvalidDslCallError("createRoundId: roundIndex must be a positive integer.");
  }
  const paddedIndex = roundIndex.toString().padStart(4, "0");
  return `${loopId}-round-${paddedIndex}`;
}

/**
 * Input for createLoopAgentId.
 */
export interface CreateLoopAgentIdInput {
  loopId: string;
  roundIndex: number;
  suffix?: string;
}

/**
 * Creates a stable agent identifier for use inside a loop round.
 */
export function createLoopAgentId(input: CreateLoopAgentIdInput): string {
  const roundId = createRoundId(input.loopId, input.roundIndex);

  if (input.suffix) {
    const trimmedSuffix = input.suffix.trim();
    if (trimmedSuffix === "") {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot be empty or whitespace-only.");
    }
    if (trimmedSuffix === "." || trimmedSuffix === "..") {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot be '.' or '..'.");
    }
    if (trimmedSuffix.includes("/") || trimmedSuffix.includes("\\")) {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot contain path separators.");
    }
    if (trimmedSuffix.includes("..")) {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot contain path traversal segments.");
    }
    if (!ID_NAME_PATTERN.test(trimmedSuffix)) {
      throw new InvalidDslCallError(
        `createLoopAgentId: suffix '${input.suffix}' contains invalid characters. Only alphanumeric, underscores, dots, colons, and hyphens are allowed.`
      );
    }
    return `${roundId}-${trimmedSuffix}`;
  }

  return roundId;
}
