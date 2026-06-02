export const meta = {
  name: "pipeline-stage-barrier",
  description: "Test pipeline stage-barrier strategy"
};

const items = ["item1", "item2"];
const stages = [
  {
    name: "stage1",
    run: async (item, ctx) => {
      ctx.log(`stage1 started for ${item}`);
      if (item === "item1") {
        await ctx.sleep(80);
      } else {
        await ctx.sleep(10);
      }
      ctx.log(`stage1 completed for ${item}`);
      return `${item}-s1`;
    }
  },
  {
    name: "stage2",
    run: async (item, ctx) => {
      ctx.log(`stage2 started for ${item}`);
      return `${item}-s2`;
    }
  }
];

const results = await pipeline(items, stages, {
  strategy: "stage-barrier",
  concurrency: 2
});

export default { results };
