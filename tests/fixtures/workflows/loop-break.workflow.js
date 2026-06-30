export const meta = {
  name: "loop-break",
  description: "Test loop completion (formerly break)"
};

const result = await loop({
  label: "loop-break",
  initialState: { count: 0 },
  options: { maxRounds: 5 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;

    await ctx.agent({
      id: ctx.agentId(`agent-${nextCount}`),
      provider: "mock",
      prompt: `Round ${nextCount}`
    });

    if (nextCount >= 2) {
      return {
        done: true,
        nextState: { count: nextCount }
      };
    }

    return {
      done: false,
      nextState: { count: nextCount }
    };
  }
});

export default result;
