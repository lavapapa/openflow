import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({
  id: "custom-tool",
  description: "A tool in a custom directory",
  run: async () => {},
  inputSchema: { type: "object" },
  execute: async () => {}
});
