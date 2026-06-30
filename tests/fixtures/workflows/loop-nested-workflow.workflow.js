export const meta = {
  name: "loop-nested-workflow",
  description: "Test loop with nested workflow"
};

const result = await loop({
  label: "nested-workflow-loop",
  initialState: { count: 0 },
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    const w = await ctx.workflow({ name: "valid-basic" });
    return { done: true, nextState: { w } };
  }
});

export default result;
