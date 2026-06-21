export const meta = {
  name: "loop-resume-nested-child",
  description: "Child workflow for loop resume cache test"
};

export default async (ctx) => {
  const res = await ctx.agent({
    id: "nested-child-agent",
    provider: "mock",
    prompt: "child agent prompt"
  });
  return res;
};
