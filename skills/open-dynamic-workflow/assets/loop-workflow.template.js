export const meta = {
  name: "loop-review",
  description: "Iteratively review and improve a plan until accepted or max rounds is reached",
  phases: ["iterate", "summarize"]
};

phase("iterate");

const loopResult = await loop(
  {
    plan: "Initial implementation plan",
    remainingIssues: []
  },
  async (state, ctx) => {
    const review = await ctx.agent({
      id: ctx.agentId("review"),
      provider: "codex",
      prompt: `Review this plan and identify remaining issues:\n${JSON.stringify(state, null, 2)}`
    });

    const revision = await ctx.agent({
      id: ctx.agentId("revision"),
      provider: "gemini",
      prompt: `Revise the plan based on this review:\n${JSON.stringify(review, null, 2)}`
    });

    const verification = await ctx.agent({
      id: ctx.agentId("verify"),
      provider: "codex",
      prompt: `Verify the revised plan and return JSON with accepted, reason, remainingIssues, and revisedPlan:\n${JSON.stringify(revision, null, 2)}`,
      schema: {
        type: "object",
        properties: {
          accepted: { type: "boolean" },
          reason: { type: "string" },
          remainingIssues: {
            type: "array",
            items: { type: "string" }
          },
          revisedPlan: { type: "string" }
        },
        required: ["accepted", "reason", "remainingIssues", "revisedPlan"]
      },
      structuredOutput: {
        transport: "auto"
      }
    });

    if (verification.json?.accepted === true) {
      return ctx.break(
        { review, revision, verification },
        {
          reason: verification.json.reason,
          state: {
            plan: verification.json.revisedPlan,
            remainingIssues: []
          }
        }
      );
    }

    return {
      review,
      revision,
      verification
    };
  },
  {
    label: "loop-review",
    maxRounds: 5,
    failureMode: "fail-fast",
    nextState: ({ state, round }) => ({
      plan: round.result?.verification?.json?.revisedPlan ?? state.plan,
      remainingIssues: round.result?.verification?.json?.remainingIssues ?? state.remainingIssues
    })
  }
);

phase("summarize");

export default {
  loopResult
};
