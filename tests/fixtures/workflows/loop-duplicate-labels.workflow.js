export const meta = {
  name: "loop-duplicate-labels",
  description: "Runs two loop instances with the same label and same child workflow"
};

const loop1 = await loop({
  label: "duplicate-loop",
  initialState: {},
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    await ctx.workflow({ name: "valid-basic" });
    return { done: true, nextState: {} };
  }
});

const loop2 = await loop({
  label: "duplicate-loop",
  initialState: {},
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    await ctx.workflow({ name: "valid-basic" });
    return { done: true, nextState: {} };
  }
});

export default { loop1, loop2 };
