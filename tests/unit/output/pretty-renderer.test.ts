import { describe, it, expect } from "vitest";
import { renderPrettyView } from "../../../src/output/pretty-renderer.js";
import type { PrettyRunView } from "../../../src/output/pretty-view.js";

describe("PrettyRenderer", () => {
  it("should render a successful four-section layout", () => {
    const view: PrettyRunView = {
      header: { name: "test-run", workflowFile: "test.ts" },
      execution: [
        {
          id: "root",
          kind: "workflow",
          name: "root",
          status: "succeeded",
          isRoot: true,
          children: [
            {
              id: "p1",
              kind: "phase",
              name: "setup",
              status: "succeeded",
              children: [
                {
                  id: "a1",
                  kind: "agent",
                  label: "Agent 1",
                  provider: "openai",
                  status: "succeeded",
                  durationMs: 500,
                },
              ],
            },
          ],
        },
      ],
      summary: {
        status: "succeeded",
        durationMs: 1500,
        workflowCounts: { succeeded: 1, failed: 0, cancelled: 0, total: 1 } as any,
        agentCounts: { succeeded: 1, failed: 0, cancelled: 0, total: 1 } as any,
        loopCounts: { succeeded: 0, failed: 0, cancelled: 0, total: 0 } as any,
      },
      artifacts: {
        rootDir: "/tmp/run",
        reportPath: "/tmp/run/report.json",
        failedSubpaths: [],
      },
      failureRecords: [],
    };

    const output = renderPrettyView(view);
    
    expect(output).toContain("◇ test-run");
    expect(output).toContain("file: test.ts");
    expect(output).toContain("Execution");
    expect(output).toContain("→ setup");
    expect(output).toContain("✓ Agent 1  openai  0.5s");
    expect(output).toContain("Summary");
    expect(output).toContain("status:    succeeded");
    expect(output).toContain("duration:  1.5s");
    expect(output).toContain("Artifacts");
    expect(output).toContain("  /tmp/run");
  });

  it("should render a failed child workflow with a status marker", () => {
    const view: PrettyRunView = {
      header: { name: "test-run" },
      execution: [
        {
          id: "root",
          kind: "workflow",
          name: "root",
          status: "failed",
          isRoot: true,
          children: [
            {
              id: "child1",
              kind: "workflow",
              name: "child-wf",
              status: "failed",
              durationMs: 1200,
              children: [],
            },
          ],
        },
      ],
      summary: {
        status: "failed",
        durationMs: 1500,
        workflowCounts: { succeeded: 0, failed: 2, timed_out: 0, cancelled: 0, skipped: 0, total: 2 },
        agentCounts: { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 },
        loopCounts: { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 },
      },
      artifacts: { rootDir: "/tmp/run", failedSubpaths: [] },
      failureRecords: [],
    };

    const output = renderPrettyView(view);
    expect(output).toContain("✕ workflow child-wf  1.2s");
  });
});
