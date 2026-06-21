export const meta = {
  name: "invalid-loop-max-rounds",
  description: "Test loop with maxRounds above ceiling"
};

await loop({
  label: "invalid-max-rounds",
  initialState: {},
  options: { maxRounds: 100 },
  run: async () => ({ done: true, nextState: {} })
});
