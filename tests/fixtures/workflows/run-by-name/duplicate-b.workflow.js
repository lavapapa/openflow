export const meta = {
  name: "duplicate-review",
  description: "Duplicate review B"
};

await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Duplicate B"
});
