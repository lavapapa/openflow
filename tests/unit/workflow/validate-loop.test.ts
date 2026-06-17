import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";

function makeWorkflow(body: string): ParsedWorkflow {
  return {
    meta: { name: "test", description: "" },
    body,
    sourcePath: "test.ts",
    sourceText: body,
    sourceHash: "hash"
  };
}

describe("Workflow static validation: loop()", () => {
  it("passes valid loop() call", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 }, async (state) => {
          return { count: state.count + 1 };
        }, { maxRounds: 5 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues).toHaveLength(0);
  });

  it("fails loop() with too few arguments", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("requires at least two arguments"))).toBe(true);
  });

  it("fails loop() with too many arguments", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 }, async () => {}, {}, "extra");
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("accepts at most three arguments"))).toBe(true);
  });

  it("fails if maxRounds exceeds ceiling", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 }, async () => {}, { maxRounds: 100 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false, maxLoopRounds: 60 });
    expect(issues.some(i => i.message.includes("exceeds the configured ceiling of 60"))).toBe(true);
  });

  it("fails if tool() is used inside loop round", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 }, async (state, ctx) => {
          await ctx.tool({ definition: "t", args: {} });
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
    expect(issues.some(i => i.message.includes("loop round"))).toBe(true);
  });

  it("allows agent() inside loop round", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 }, async (state, ctx) => {
          await ctx.agent({ prompt: "hi" });
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.filter(i => i.message.includes("agent() is not allowed")).length).toBe(0);
  });

  it("fails global loop() with maxRounds exceeding ceiling", () => {
    const workflow = makeWorkflow(`
      export default async () => {
        await loop({}, async () => {}, { maxRounds: 61 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false, maxLoopRounds: 60 });
    expect(issues.some(i => i.message.includes("exceeds the configured ceiling of 60"))).toBe(true);
  });

  it("passes global loop() with maxRounds at ceiling", () => {
    const workflow = makeWorkflow(`
      export default async () => {
        await loop({}, async () => {}, { maxRounds: 60 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false, maxLoopRounds: 60 });
    expect(issues).toHaveLength(0);
  });

  it("fails if tool() is used inside global loop() round", () => {
    const workflow = makeWorkflow(`
      export default async () => {
        await loop({}, async () => {
          await tool({ definition: "t", args: {} });
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects static maxRounds: 6 when ceiling is 5", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({}, async () => {}, { maxRounds: 6 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false, maxLoopRounds: 5 });
    expect(issues.some(i => i.message.includes("exceeds the configured ceiling of 5"))).toBe(true);
  });

  it("accepts static maxRounds: 5 when ceiling is 5", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({}, async () => {}, { maxRounds: 5 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false, maxLoopRounds: 5 });
    expect(issues).toHaveLength(0);
  });

  it("rejects invalid static maxRounds values", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { maxRounds: -1 }); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("maxRounds must be a positive integer"))).toBe(true);

    const w2 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { maxRounds: 0 }); }`);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("maxRounds must be a positive integer"))).toBe(true);

    const w3 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { maxRounds: "5" }); }`);
    expect(validateWorkflow(w3, { allowImports: false }).some(i => i.message.includes("maxRounds must be a positive integer"))).toBe(true);
  });

  it("rejects invalid static timeoutMs values", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { timeoutMs: -10 }); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("timeoutMs must be a positive integer"))).toBe(true);

    const w2 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { timeoutMs: "100" }); }`);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("timeoutMs must be a positive integer"))).toBe(true);
  });

  it("rejects invalid failureMode static values", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { failureMode: 1 }); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("failureMode must be a string literal"))).toBe(true);

    const w2 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { failureMode: "invalid" }); }`);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("failureMode must be"))).toBe(true);
  });

  it("rejects failureMode continue without onFailureState", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { failureMode: "continue" }); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("onFailureState is required"))).toBe(true);
  });

  it("rejects invalid resultMode", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { resultMode: "full" }); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("resultMode must be"))).toBe(true);
  });

  it("rejects non-function values for stopWhen, nextState, and onFailureState", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, { stopWhen: true }); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("stopWhen must be a function"))).toBe(true);
  });

  it("rejects invalid static non-object loop options", () => {
    const w1 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, "bad"); }`);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("options must be an object literal"))).toBe(true);

    const w2 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, []); }`);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("options must be an object literal"))).toBe(true);

    const w3 = makeWorkflow(`export default async (ctx) => { await ctx.loop({}, async () => {}, null); }`);
    expect(validateWorkflow(w3, { allowImports: false }).some(i => i.message.includes("options must be an object literal"))).toBe(true);

    const w4 = makeWorkflow(`export default async () => { await loop({}, async () => {}, "bad"); }`);
    expect(validateWorkflow(w4, { allowImports: false }).some(i => i.message.includes("options must be an object literal"))).toBe(true);
  });

  it("allows dynamic options expression at static validation time", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        const opts = getOptions();
        await ctx.loop({}, async () => {}, opts);
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false })).toHaveLength(0);
  });
});
