import { InvalidDslCallError } from "../workflow/errors.js";
import type { LoopOptions, NormalizedLoopOptions, LoopFailureMode } from "./types.js";

const ALLOWED_OPTION_KEYS = [
  "label",
  "maxRounds",
  "stopWhen",
  "nextState",
  "onFailureState",
  "failureMode",
  "timeoutMs",
  "resultMode",
  "metadata",
];

/**
 * Validates and normalizes loop arguments.
 */
export function validateAndNormalizeLoopArgs<TState, TRoundResult, TFinal>(
  initialState: unknown,
  runRound: unknown,
  options: unknown,
  maxRoundsCeiling: number
): NormalizedLoopOptions<TState, TRoundResult, TFinal> {
  // 1. Validate initialState (must be JSON-serializable, checked at runtime during cloning)
  // We don't deep-validate here, but we ensure it's provided (can be null/0/false though)
  if (initialState === undefined) {
    throw new InvalidDslCallError("loop() missing initialState.");
  }

  // 2. Validate runRound
  if (runRound === undefined) {
    throw new InvalidDslCallError("loop() missing runRound callback.");
  }
  if (typeof runRound !== "function") {
    throw new InvalidDslCallError("loop() runRound must be a function.");
  }

  // 3. Validate options
  const presentOptions: string[] = [];
  let normalizedOptions: NormalizedLoopOptions<TState, TRoundResult, TFinal> = {
    maxRounds: 5,
    failureMode: "fail-fast",
    maxRoundsCeiling,
    presentOptions,
  };

  if (options !== undefined) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new InvalidDslCallError("loop() options must be an object.");
    }

    const optionKeys = Object.keys(options);
    for (const key of optionKeys) {
      if (!ALLOWED_OPTION_KEYS.includes(key)) {
        throw new InvalidDslCallError(`loop() options contain unsupported key '${key}'.`);
      }
      presentOptions.push(key);
    }

    const opts = options as LoopOptions<TState, TRoundResult, TFinal>;

    if (opts.label !== undefined) {
      if (typeof opts.label !== "string" || opts.label.trim() === "") {
        throw new InvalidDslCallError("loop() options label must be a non-empty string.");
      }
      normalizedOptions.label = opts.label;
    }

    if (opts.maxRounds !== undefined) {
      if (typeof opts.maxRounds !== "number" || opts.maxRounds < 1 || !Number.isInteger(opts.maxRounds)) {
        throw new InvalidDslCallError("loop() options maxRounds must be a positive integer.");
      }
      if (opts.maxRounds > maxRoundsCeiling) {
        throw new InvalidDslCallError(
          `loop() options maxRounds (${opts.maxRounds}) exceeds the global ceiling (${maxRoundsCeiling}).`
        );
      }
      normalizedOptions.maxRounds = opts.maxRounds;
    }

    if (opts.stopWhen !== undefined) {
      if (typeof opts.stopWhen !== "function") {
        throw new InvalidDslCallError("loop() options stopWhen must be a function.");
      }
      normalizedOptions.stopWhen = opts.stopWhen;
    }

    if (opts.nextState !== undefined) {
      if (typeof opts.nextState !== "function") {
        throw new InvalidDslCallError("loop() options nextState must be a function.");
      }
      normalizedOptions.nextState = opts.nextState;
    }

    if (opts.onFailureState !== undefined) {
      if (typeof opts.onFailureState !== "function") {
        throw new InvalidDslCallError("loop() options onFailureState must be a function.");
      }
      normalizedOptions.onFailureState = opts.onFailureState;
    }

    if (opts.failureMode !== undefined) {
      const validModes: LoopFailureMode[] = ["fail-fast", "settled", "continue"];
      if (!validModes.includes(opts.failureMode)) {
        throw new InvalidDslCallError(
          `loop() options failureMode must be one of: ${validModes.join(", ")}.`
        );
      }
      
      if (opts.failureMode === "continue" && typeof opts.onFailureState !== "function") {
        throw new InvalidDslCallError(
          "loop() options failureMode 'continue' requires a valid onFailureState function."
        );
      }
      
      normalizedOptions.failureMode = opts.failureMode;
    }

    if (opts.timeoutMs !== undefined) {
      if (typeof opts.timeoutMs !== "number" || opts.timeoutMs <= 0 || !Number.isInteger(opts.timeoutMs)) {
        throw new InvalidDslCallError("loop() options timeoutMs must be a positive integer.");
      }
      normalizedOptions.timeoutMs = opts.timeoutMs;
    }

    if (opts.resultMode !== undefined) {
      if (opts.resultMode !== "history") {
        throw new InvalidDslCallError("loop() options resultMode must be 'history'.");
      }
      normalizedOptions.resultMode = opts.resultMode;
    }

    if (opts.metadata !== undefined) {
      if (!opts.metadata || typeof opts.metadata !== "object" || Array.isArray(opts.metadata)) {
        throw new InvalidDslCallError("loop() options metadata must be a plain object.");
      }
      normalizedOptions.metadata = opts.metadata;
    }
  }

  return normalizedOptions;
}
