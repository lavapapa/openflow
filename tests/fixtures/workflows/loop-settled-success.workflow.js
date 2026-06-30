export const meta = {
  name: "loop-settled-success",
  description: "Test loop settled success mode"
};

const result = await loop({
  label: "settled-success-loop",
  initialState: { count: 0 },
  options: { maxRounds: 5, failureMode: "settled" },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount } };
    }
    return { done: false, nextState: { count: nextCount } };
  }
});

export default result;
