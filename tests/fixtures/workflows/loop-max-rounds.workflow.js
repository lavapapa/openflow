export const meta = {
  name: "loop-max-rounds",
  description: "Test loop reaching max rounds"
};

const result = await loop({
  label: "loop-max-rounds",
  initialState: { count: 0 },
  options: { maxRounds: 2 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    await ctx.agent({
      id: `agent-${nextCount}`,
      provider: "mock",
      prompt: `Round ${nextCount}`
    });
    return { done: false, nextState: { count: nextCount } };
  }
});

export default result;
