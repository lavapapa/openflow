export const meta = {
  name: "loop-nested-parallel",
  description: "Test loop with nested global parallel"
};

const result = await loop({
  label: "nested-parallel-loop",
  initialState: { count: 0 },
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    const p = await parallel({
      a: () => ctx.agent({ provider: "mock", prompt: "A" }),
      b: () => ctx.agent({ provider: "mock", prompt: "B" })
    });

    return { done: true, nextState: { p } };
  }
});

export default result;
