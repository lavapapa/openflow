export const meta = {
  name: "invalid-loop-tool",
  description: "Test forbidden tool usage in loop"
};

await loop({
  label: "invalid-tool-loop",
  initialState: {},
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    await tool({ definition: "x", args: {} });
    return { done: true, nextState: {} };
  }
});
