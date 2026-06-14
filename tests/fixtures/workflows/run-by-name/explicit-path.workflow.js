export const meta = {
  name: "explicit-path-test",
  description: "Explicit path test workflow"
};

await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Explicit Path"
});
