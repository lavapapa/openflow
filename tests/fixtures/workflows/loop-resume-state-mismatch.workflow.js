export const meta = {
  name: "loop-resume-state-mismatch",
  description: "Test loop resume cache mismatch due only to initialState hash change"
};

const result = await loop({
  label: "resume-loop",
  initialState: { count: 0, flag: true },
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    await ctx.agent({
      id: ctx.agentId("resume"),
      provider: "mock",
      prompt: `Round 1`
    });
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount, flag: state.flag } };
    }
    return { done: false, nextState: { count: nextCount, flag: state.flag } };
  }
});

export default result;
