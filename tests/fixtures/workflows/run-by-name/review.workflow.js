export const meta = {
  name: "review",
  description: "Review workflow"
};

await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Review"
});
