export const meta = {
  name: "duplicate-review",
  description: "Duplicate review A"
};

await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Duplicate A"
});
