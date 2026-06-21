export const meta = {
  name: "loop-return-break",
  description: "Test loop with done: true return"
};

const result = await loop({
  label: "loop-return-break",
  initialState: { count: 0 },
  options: { maxRounds: 5 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount } };
    }
    return { done: false, nextState: { count: nextCount } };
  }
});

export default result;
