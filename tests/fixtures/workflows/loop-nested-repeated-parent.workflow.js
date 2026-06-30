export const meta = {
  name: "loop-nested-repeated-parent",
  description: "Parent workflow for loop R018 test"
};

const result = await loop({
  label: "repeated-parent-loop",
  initialState: { count: 0 },
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    await ctx.workflow({
      name: "loop-nested-repeated-child",
      args: { agentId: ctx.agentId("test-permissions-agent") }
    });
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount } };
    }
    return { done: false, nextState: { count: nextCount } };
  }
});

export default result;
