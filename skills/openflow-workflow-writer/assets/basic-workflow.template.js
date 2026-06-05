export const meta = {
  name: "basic-workflow",
  description: "Run a basic OpenFlow workflow",
  phases: ["execute"]
};

phase("execute");

const result = await agent({
  id: "main-task",
  provider: "codex",
  prompt: "Complete the requested task."
});

export default {
  result
};
