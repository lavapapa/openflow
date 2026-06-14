export const meta = {
  name: "Review",
  description: "Case-sensitive review workflow"
};

await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Case Review"
});
