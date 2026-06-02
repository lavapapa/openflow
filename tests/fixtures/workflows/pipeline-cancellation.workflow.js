export const meta = {
  name: "pipeline-cancellation",
  description: "Test pipeline cancellation"
};

const items = ["item1"];
const stages = [
  {
    name: "stage1",
    run: async (item, ctx) => {
      ctx.log("stage1 started");
      await ctx.sleep(200);
      ctx.log("stage1 completed");
      return item;
    }
  }
];

const results = await pipeline(items, stages);
export default { results };
