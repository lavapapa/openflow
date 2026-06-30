export const meta = {
  // missing name, or could be invalid in other ways
  description: "Invalid workflow"
};

await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Invalid"
});
