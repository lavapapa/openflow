export const meta = {
  name: "loop-resume-cache-nested-result",
  description: "Test loop resume/cache behavior when nested result is stored in loop state"
};

const result = await loop({
  label: "resume-nested-result-loop",
  initialState: { count: 0, lastResult: null },
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    const agentResult = await ctx.agent({
      id: ctx.agentId("nested-agent"),
      provider: "mock",
      prompt: `Round ${nextCount}`
    });
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount, lastResult: agentResult } };
    }
    return { done: false, nextState: { count: nextCount, lastResult: agentResult } };
  }
});

export default result;
