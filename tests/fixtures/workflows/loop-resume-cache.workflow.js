export const meta = {
  name: "loop-resume-cache",
  description: "Test loop resume/cache behavior"
};

const result = await loop({
  label: "resume-loop",
  initialState: { count: 0 },
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    await ctx.agent({
      id: ctx.agentId("resume"),
      provider: "mock",
      prompt: `Round ${nextCount}`
    });
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount } };
    }
    return { done: false, nextState: { count: nextCount } };
  }
});

export default result;
