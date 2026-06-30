import { describe, it, expect } from "vitest";
import { PrettyViewBuilder } from "../../../src/output/pretty-view-builder.js";
import type { EventEnvelope } from "../../../src/output/events.js";
import type { WorkflowNode, PhaseNode } from "../../../src/output/pretty-view.js";

describe("PrettyViewBuilder", () => {
  it("should build a minimal header", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({
      meta: { name: "test-run" },
      workflow: { file: "test.ts" }
    } as any);

    const view = builder.build({
      status: "succeeded",
      durationMs: 100,
      artifactsDir: "/tmp/run",
    } as any);

    expect(view.header.name).toBe("test-run");
    expect(view.header.workflowFile).toBe("test.ts");
    expect(view.summary.status).toBe("succeeded");
  });

  it("should aggregate nested workflows and phases", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "root" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "root" },
      },
      {
        type: "phase.started",
        payload: { workflowInvocationId: "root-id", name: "setup" },
      },
      {
        type: "agent.started",
        payload: { workflowInvocationId: "root-id", agentRunId: "a1", label: "Agent 1", provider: "openai" },
      },
      {
        type: "agent.completed",
        payload: { agentRunId: "a1", durationMs: 500 },
      },
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "child-id", workflowName: "child", parentWorkflowInvocationId: "root-id" },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "child-id", durationMs: 200 },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "root-id", durationMs: 1000 },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "succeeded", durationMs: 1000 } as any);

    expect(view.execution).toHaveLength(1);
    const rootNode = view.execution[0] as WorkflowNode;
    expect(rootNode.kind).toBe("workflow");
    expect(rootNode.children).toHaveLength(1); // Just the Phase
    
    const phase = rootNode.children[0] as PhaseNode;
    expect(phase.kind).toBe("phase");
    expect(phase.children).toHaveLength(2); // Agent 1 AND Child Workflow
    
    expect(phase.children[0].kind).toBe("agent");
    expect(phase.children[1].kind).toBe("workflow");
    expect((phase.children[1] as WorkflowNode).name).toBe("child");

    expect(view.summary.workflowCounts.total).toBe(2);
    expect(view.summary.agentCounts.total).toBe(1);
  });

  it("should capture terminal statuses for child workflows", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "root" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "root" },
      },
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "child-timeout-id", workflowName: "child-timeout", parentWorkflowInvocationId: "root-id" },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "child-timeout-id", durationMs: 5000, status: "timed_out" },
      },
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "child-cancel-id", workflowName: "child-cancel", parentWorkflowInvocationId: "root-id" },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "child-cancel-id", durationMs: 1000, status: "cancelled" },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "root-id", durationMs: 7000, status: "failed" },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "failed", durationMs: 7000 } as any);

    const rootNode = view.execution[0] as WorkflowNode;
    const childTimeout = rootNode.children.find(c => c.kind === "workflow" && (c as WorkflowNode).name === "child-timeout") as WorkflowNode;
    const childCancel = rootNode.children.find(c => c.kind === "workflow" && (c as WorkflowNode).name === "child-cancel") as WorkflowNode;

    expect(childTimeout.status).toBe("timed_out");
    expect(childCancel.status).toBe("cancelled");
  });

  it("should handle workflows without phases (TC-PR-09)", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "no-phase" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "no-phase" },
      },
      {
        type: "agent.started",
        payload: { workflowInvocationId: "root-id", agentRunId: "a1", label: "Agent 1", provider: "mock" },
      },
      {
        type: "agent.completed",
        payload: { agentRunId: "a1", durationMs: 100 },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "root-id", durationMs: 200 },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "succeeded", durationMs: 200 } as any);

    expect(view.execution).toHaveLength(1);
    const rootNode = view.execution[0] as WorkflowNode;
    expect(rootNode.children).toHaveLength(1);
    expect(rootNode.children[0].kind).toBe("agent");
  });
});
