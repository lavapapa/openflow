import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter, createLimiter } from "../../../src/pipeline/concurrency.js";

describe("concurrency limiter", () => {
  it("allows running tasks up to a limit in parallel", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let maxActive = 0;

    const runTask = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
    };

    await Promise.all([
      limiter.run(runTask),
      limiter.run(runTask),
      limiter.run(runTask),
      limiter.run(runTask)
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles limit of Infinity or undefined", async () => {
    const limiter = createLimiter(Infinity);
    let active = 0;
    let maxActive = 0;

    const runTask = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    };

    await Promise.all([
      limiter.run(runTask),
      limiter.run(runTask),
      limiter.run(runTask)
    ]);

    expect(maxActive).toBe(3);
  });
});
