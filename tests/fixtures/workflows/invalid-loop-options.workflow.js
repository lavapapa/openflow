export const meta = {
  name: "invalid-loop-options",
  description: "Test static validation of loop options"
};

const result = await loop({
  label: "",
  initialState: { count: 0 },
  options: {
    maxRounds: -1,
    timeoutMs: 0,
    failureMode: "invalid-mode"
  },
  run: async (state, ctx) => {
    return { done: true, nextState: { count: state.count + 1 } };
  }
});

export default result;
