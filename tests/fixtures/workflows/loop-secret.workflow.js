export const meta = {
  name: "loop-secret",
  description: "Test loop leakage with secret"
};

const result = await loop({
  label: "secret-loop",
  initialState: { count: 0 },
  options: { maxRounds: 2 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    
    await ctx.agent({
      id: `agent-${nextCount}`,
      provider: "mock",
      prompt: `Round ${nextCount}`
    });

    if (nextCount >= 1) {
      return {
        done: true,
        nextState: { secret: "SECRET_SHOULD_NOT_BE_IN_EVENTS" }
      };
    }

    return {
      done: false,
      nextState: { count: nextCount }
    };
  }
});

export default { success: true };
