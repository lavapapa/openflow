import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createOpenFlow } from "../../src/sdk/index.js";

const TEMP_DIR = path.resolve("tests/temp-sdk-client");

async function collectEvents(run: { events: AsyncIterable<any>; result: Promise<any> }) {
  const events: any[] = [];
  for await (const event of run.events) {
    events.push(event);
  }
  const result = await run.result;
  return { events, result };
}

describe("OpenFlow SDK client", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("runs a workflow and exposes live events, report inspection, and run listing", async () => {
    const runsDir = path.join(TEMP_DIR, "runs");
    const workflowPath = path.join(TEMP_DIR, "workflows/basic.ts");
    await fs.writeFile(workflowPath, `
export const meta = { name: "sdk-basic", description: "test" };

const answer = await agent({ id: "hello", provider: "mock", prompt: "Say hello." });

export default { answer };
`, "utf8");

    const openflow = createOpenFlow({
      workspace: { cwd: TEMP_DIR, runsDir }
    });

    const run = await openflow.run({
      workflow: { kind: "file", path: workflowPath },
      args: { topic: "sdk" }
    });
    const { events, result } = await collectEvents(run);

    expect(result.status).toBe("succeeded");
    expect(result.result).toMatchObject({ answer: { text: "mock response", provider: "mock" } });
    expect(result.artifactsDir).toBe(path.join(runsDir, run.runId));
    expect(events.map((event) => event.type)).toContain("workflow.started");
    expect(events.map((event) => event.type)).toContain("agent.output");
    expect(events.at(-1)?.type).toBe("workflow.completed");

    const inspected = await openflow.inspectRun({ runId: run.runId });
    expect(inspected.report?.status).toBe("succeeded");
    const runs = await openflow.listRuns();
    expect(runs[0]).toMatchObject({ runId: run.runId, status: "succeeded" });
  });
});
