export const meta = {
  name: "loop-resume-nested-parent",
  description: "Parent loop workflow that calls a child workflow and stores its result"
};

const result = await loop({
  label: "resume-nested-parent-loop",
  initialState: { count: 0, lastResult: null },
  options: { maxRounds: 3 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;
    const childResult = await ctx.workflow({
      name: "loop-resume-nested-child"
    });
    if (nextCount >= 2) {
      return { done: true, nextState: { count: nextCount, lastResult: childResult } };
    }
    return { done: false, nextState: { count: nextCount, lastResult: childResult } };
  }
});

export default result;
