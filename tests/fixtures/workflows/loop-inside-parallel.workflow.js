export const meta = {
  name: "loop-inside-parallel",
  description: "Test loops running inside parallel tasks"
};

const result = await parallel({
  auth: () => loop({
    label: "parallel-auth-loop",
    initialState: { count: 0 },
    options: { maxRounds: 1 },
    run: async (state, ctx) => {
      const a = await ctx.agent({
        id: ctx.agentId("review"),
        provider: "mock",
        prompt: "auth-review"
      });
      return { done: true, nextState: { count: state.count + 1, a } };
    }
  }),
  billing: () => loop({
    label: "parallel-billing-loop",
    initialState: { count: 0 },
    options: { maxRounds: 1 },
    run: async (state, ctx) => {
      const b = await ctx.agent({
        id: ctx.agentId("review"),
        provider: "mock",
        prompt: "billing-review"
      });
      return { done: true, nextState: { count: state.count + 1, b } };
    }
  })
});

export default result;
