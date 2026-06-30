export const meta = {
  name: "loop-stop-when",
  description: "Test loop with stopWhen (expressed as done: true in run callback)"
};

const result = await loop({
  label: "stop-when-loop",
  initialState: { count: 0 },
  options: { maxRounds: 5 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    await ctx.agent({
      id: `agent-${nextCount}`,
      provider: "mock",
      prompt: `Round ${nextCount}`
    });
    return {
      done: nextCount >= 3,
      nextState: { count: nextCount }
    };
  }
});

export default result;
