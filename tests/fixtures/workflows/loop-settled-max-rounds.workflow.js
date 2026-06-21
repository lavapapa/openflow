export const meta = {
  name: "loop-settled-max-rounds",
  description: "Test settled loop max rounds"
};

const result = await loop({
  label: "settled-max-rounds-loop",
  initialState: { count: 0 },
  options: { maxRounds: 2, failureMode: "settled" },
  run: async (state, ctx) => {
    return { done: false, nextState: { count: state.count + 1 } };
  }
});

export default result;
