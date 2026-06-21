export const meta = {
  name: "loop-nested-repeated-child",
  description: "Child workflow for loop R018 test"
};

export default async (ctx) => {
  const res = await ctx.agent({
    id: ctx.args?.agentId || "test-permissions-agent",
    provider: "mock",
    prompt: "child agent prompt"
  });
  return res;
};
