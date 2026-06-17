import { describe, expect, it } from "vitest";
import { validateAndNormalizeLoopArgs } from "../../../src/loop/validate.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Loop Validation Helpers", () => {
  const ceiling = 60;
  const mockRound = () => {};

  it("accepts valid minimal arguments", () => {
    const result = validateAndNormalizeLoopArgs({}, mockRound, undefined, ceiling);
    expect(result.maxRounds).toBe(5);
    expect(result.failureMode).toBe("fail-fast");
  });

  it("throws if initialState is missing", () => {
    expect(() => validateAndNormalizeLoopArgs(undefined, mockRound, {}, ceiling)).toThrow(
      "loop() missing initialState."
    );
  });

  it("throws if runRound is missing or not a function", () => {
    expect(() => validateAndNormalizeLoopArgs({}, undefined, {}, ceiling)).toThrow(
      "loop() missing runRound callback."
    );
    expect(() => validateAndNormalizeLoopArgs({}, "not-a-func", {}, ceiling)).toThrow(
      "loop() runRound must be a function."
    );
  });

  it("validates maxRounds against ceiling", () => {
    expect(() =>
      validateAndNormalizeLoopArgs({}, mockRound, { maxRounds: 61 }, ceiling)
    ).toThrow("exceeds the global ceiling (60)");
    
    const result = validateAndNormalizeLoopArgs({}, mockRound, { maxRounds: 60 }, ceiling);
    expect(result.maxRounds).toBe(60);
  });

  it("throws on unsupported option keys", () => {
    expect(() =>
      validateAndNormalizeLoopArgs({}, mockRound, { unknownKey: true }, ceiling)
    ).toThrow("loop() options contain unsupported key 'unknownKey'.");
  });

  it("validates failureMode: 'continue' requires onFailureState", () => {
    expect(() =>
      validateAndNormalizeLoopArgs({}, mockRound, { failureMode: "continue" }, ceiling)
    ).toThrow("requires a valid onFailureState function.");

    const result = validateAndNormalizeLoopArgs(
      {},
      mockRound,
      { failureMode: "continue", onFailureState: () => ({}) },
      ceiling
    );
    expect(result.failureMode).toBe("continue");
  });

  it("validates timeoutMs is a positive integer", () => {
    expect(() =>
      validateAndNormalizeLoopArgs({}, mockRound, { timeoutMs: -1 }, ceiling)
    ).toThrow("timeoutMs must be a positive integer.");
    expect(() =>
      validateAndNormalizeLoopArgs({}, mockRound, { timeoutMs: 1.5 }, ceiling)
    ).toThrow("timeoutMs must be a positive integer.");
  });

  it("validates resultMode is 'history'", () => {
    expect(() =>
      validateAndNormalizeLoopArgs({}, mockRound, { resultMode: "something-else" }, ceiling)
    ).toThrow("resultMode must be 'history'.");
  });

  it("captures presentOptions", () => {
    const result = validateAndNormalizeLoopArgs(
      {},
      mockRound,
      { label: "my-loop", maxRounds: 10 },
      ceiling
    );
    expect(result.presentOptions).toContain("label");
    expect(result.presentOptions).toContain("maxRounds");
    expect(result.presentOptions).not.toContain("stopWhen");
  });
});
