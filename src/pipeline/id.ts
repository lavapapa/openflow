import { InvalidDslCallError } from "../workflow/errors.js";

const STAGE_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export function createPipelineId(sequence: number): string {
  if (typeof sequence !== "number" || sequence < 1 || isNaN(sequence)) {
    throw new InvalidDslCallError("Pipeline sequence must be a positive integer.");
  }
  return `pipeline-${sequence}`;
}

export function assertValidPipelineStageName(name: string): void {
  if (typeof name !== "string") {
    throw new InvalidDslCallError("Stage name must be a string.");
  }
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new InvalidDslCallError("Stage name cannot be empty or whitespace-only.");
  }
  if (name !== trimmed) {
    throw new InvalidDslCallError("Stage name cannot have leading or trailing whitespace.");
  }
  if (name.length > 128) {
    throw new InvalidDslCallError("Stage name exceeds maximum length of 128 characters.");
  }
  if (name === "." || name === "..") {
    throw new InvalidDslCallError("Stage name cannot be '.' or '..'.");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new InvalidDslCallError("Stage name cannot contain path separators ('/' or '\\').");
  }
  if (name.includes("..")) {
    throw new InvalidDslCallError("Stage name cannot contain path traversal segments ('..').");
  }
  if (!STAGE_NAME_PATTERN.test(name)) {
    throw new InvalidDslCallError(
      `Stage name '${name}' is invalid. Only alphanumeric characters, underscores, dots, colons, and hyphens are allowed.`
    );
  }
}

export function createPipelineStageArtifactName(stageName: string): string {
  assertValidPipelineStageName(stageName);
  return stageName;
}

export interface CreatePipelineAgentIdInput {
  pipelineId: string;
  itemIndex: number;
  stageName: string;
  suffix?: string;
}

export function createPipelineAgentId(input: CreatePipelineAgentIdInput): string {
  if (!input.pipelineId || typeof input.pipelineId !== "string") {
    throw new InvalidDslCallError("createPipelineAgentId: pipelineId is required and must be a string.");
  }
  if (typeof input.itemIndex !== "number" || input.itemIndex < 0 || isNaN(input.itemIndex)) {
    throw new InvalidDslCallError("createPipelineAgentId: itemIndex must be a non-negative integer.");
  }
  assertValidPipelineStageName(input.stageName);
  
  const base = `${input.pipelineId}-item-${input.itemIndex}-${input.stageName}`;
  if (input.suffix) {
    const trimmedSuffix = input.suffix.trim();
    if (trimmedSuffix === "") {
      throw new InvalidDslCallError("createPipelineAgentId: suffix cannot be empty or whitespace-only.");
    }
    if (!STAGE_NAME_PATTERN.test(trimmedSuffix)) {
      throw new InvalidDslCallError(
        `createPipelineAgentId: suffix '${input.suffix}' contains invalid characters.`
      );
    }
    return `${base}-${trimmedSuffix}`;
  }
  return base;
}
