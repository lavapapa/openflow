export const meta = {
  name: "loop-failure-fail-fast",
  description: "Test loop with default throw failure mode"
};

const result = await loop({
  label: "loop-failure-fail-fast",
  initialState: { count: 0 },
  options: { maxRounds: 5, failureMode: "throw" },
  run: async (state, ctx) => {
    throw new Error("intentional failure");
  }
});

export default result;
