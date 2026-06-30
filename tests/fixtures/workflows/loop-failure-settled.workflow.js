export const meta = {
  name: "loop-failure-settled",
  description: "Test loop with failureMode settled"
};

const result = await loop({
  label: "loop-failure-settled",
  initialState: { count: 0 },
  options: {
    maxRounds: 2,
    failureMode: "settled"
  },
  run: async (state, ctx) => {
    throw new Error("intentional failure");
  }
});

export default result;
