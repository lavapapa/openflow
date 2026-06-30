export const meta = {
  name: "loop-resume-mismatch",
  description: "Test loop resume cache mismatch behavior"
};

const result = await loop({
  label: "resume-loop",
  initialState: { count: 5 },
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    await ctx.agent({
      id: ctx.agentId("resume"),
      provider: "mock",
      prompt: `Round ${nextCount}`
    });
    if (nextCount >= 7) {
      return { done: true, nextState: { count: nextCount } };
    }
    return { done: false, nextState: { count: nextCount } };
  }
});

export default result;
