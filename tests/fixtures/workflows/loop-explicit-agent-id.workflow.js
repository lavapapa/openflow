export const meta = {
  name: "loop-explicit-agent-id",
  description: "Test preservation of explicit agent IDs inside loops"
};

const result = await loop({
  label: "explicit-agent-loop",
  initialState: {},
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    await ctx.agent({ id: "my-agent", provider: "mock", prompt: "hello" });
    await ctx.agent({ id: ctx.agentId("review"), provider: "mock", prompt: "hello" });
    return { done: true, nextState: {} };
  }
});

export default result;
