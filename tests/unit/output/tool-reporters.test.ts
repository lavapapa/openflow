import { describe, expect, it, vi } from "vitest";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";
import { JsonReporter } from "../../../src/output/json-reporter.js";
import { JsonlReporter } from "../../../src/output/jsonl-reporter.js";
import type { EventEnvelope } from "../../../src/output/events.js";

describe("Tool Reporters", () => {
  const createToolEvent = (type: string, payload: any): EventEnvelope => ({
    schemaVersion: "open-dynamic-workflow.event.v1",
    runId: "run-1",
    sequence: 1,
    timestamp: new Date().toISOString(),
    type: type as any,
    payload
  });

  describe("PrettyReporter", () => {
    it("prints tool completion event in final layout", () => {
      let stdoutData = "";
      const stdout = { write: vi.fn((chunk) => { stdoutData += chunk.toString(); return true; }) };
      const reporter = new PrettyReporter({ stdout: stdout as any, stderr: {} as any });
      
      reporter.start({ meta: { name: "test-run" } } as any);
      
      reporter.handle(createToolEvent("tool.started", { toolCallId: "call-1", definition: "echo" }));
      reporter.handle(createToolEvent("tool.completed", {
        toolCallId: "call-1",
        definition: "echo",
        executionDurationMs: 42
      }));

      reporter.finish({ status: "succeeded", durationMs: 42, artifactsDir: "/tmp" } as any);
      
      expect(stdoutData).toContain("✓ echo  0.0s");
    });

    it("prints tool failure event in final layout", () => {
      let stdoutData = "";
      const stdout = { write: vi.fn((chunk) => { stdoutData += chunk.toString(); return true; }) };
      const reporter = new PrettyReporter({ stdout: stdout as any, stderr: {} as any });
      
      reporter.start({ meta: { name: "test-run" } } as any);
      
      reporter.handle(createToolEvent("tool.started", { toolCallId: "call-1", definition: "fail", artifactPath: "tools/call-1" }));
      reporter.handle(createToolEvent("tool.failed", {
        toolCallId: "call-1",
        definition: "fail",
        error: { message: "failed to read file" },
        artifactPath: "tools/call-1"
      }));

      reporter.finish({ status: "failed", durationMs: 100, artifactsDir: "/tmp/run" } as any);

      expect(stdoutData).toContain("✕ fail");
      expect(stdoutData).toContain("failed:");
      expect(stdoutData).toContain("- tools/call-1");
    });
  });

  describe("JsonReporter", () => {
    it("includes tools in final report", () => {
      const stdout = { write: vi.fn() };
      const reporter = new JsonReporter({ stdout: stdout as any, stderr: {} as any });
      
      const result: any = {
        status: "succeeded",
        tools: [
          { 
            toolCallId: "call-1", 
            definition: "echo", 
            ok: true, 
            durationMs: 42,
            workflowInvocationId: "root",
            artifactPath: "tools/call-1"
          }
        ]
      };

      reporter.finish(result);
      const output = JSON.parse(stdout.write.mock.calls[0][0]);
      expect(output.tools).toHaveLength(1);
      expect(output.tools[0].definition).toBe("echo");
    });
  });

  describe("JsonlReporter", () => {
    it("streams tool events", () => {
      const stdout = { write: vi.fn() };
      const reporter = new JsonlReporter({ stdout: stdout as any, stderr: {} as any });
      
      const event = createToolEvent("tool.started", { toolCallId: "call-1" });

      reporter.handle(event);
      const output = JSON.parse(stdout.write.mock.calls[0][0]);
      expect(output.type).toBe("tool.started");
      expect(output.payload.toolCallId).toBe("call-1");
    });
  });
});
