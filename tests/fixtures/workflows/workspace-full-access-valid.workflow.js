export const meta = {
  name: "workspace-full-access-valid",
  description: "A valid workspace-scoped Pi SDK permissions workflow"
};

const result = await agent({
  provider: "pi-sdk",
  prompt: "Work only inside the assigned workspace.",
  permissions: { mode: "workspace-full-access" }
});

export default result;
