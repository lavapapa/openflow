import { describe, expect, it } from "vitest";
import {
  createPipelineId,
  assertValidPipelineStageName,
  createPipelineStageArtifactName,
  createPipelineAgentId
} from "../../../src/pipeline/id.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Pipeline ID and Naming Helpers", () => {
  describe("createPipelineId", () => {
    it("generates correct pipeline ID for positive integers", () => {
      expect(createPipelineId(1)).toBe("pipeline-1");
      expect(createPipelineId(42)).toBe("pipeline-42");
    });

    it("throws on invalid sequence numbers", () => {
      expect(() => createPipelineId(0)).toThrow(InvalidDslCallError);
      expect(() => createPipelineId(-5)).toThrow(InvalidDslCallError);
      expect(() => createPipelineId(NaN)).toThrow(InvalidDslCallError);
      expect(() => createPipelineId("1" as any)).toThrow(InvalidDslCallError);
    });
  });

  describe("assertValidPipelineStageName", () => {
    it("accepts valid stage names", () => {
      expect(() => assertValidPipelineStageName("stage1")).not.toThrow();
      expect(() => assertValidPipelineStageName("analyze_content")).not.toThrow();
      expect(() => assertValidPipelineStageName("summarize-text.v1")).not.toThrow();
      expect(() => assertValidPipelineStageName("step:3")).not.toThrow();
    });

    it("rejects empty or whitespace-only names", () => {
      expect(() => assertValidPipelineStageName("")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("   ")).toThrow(InvalidDslCallError);
    });

    it("rejects names with leading or trailing whitespace", () => {
      expect(() => assertValidPipelineStageName(" stage1")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("stage1 ")).toThrow(InvalidDslCallError);
    });

    it("rejects too long names", () => {
      const longName = "a".repeat(129);
      expect(() => assertValidPipelineStageName(longName)).toThrow(InvalidDslCallError);
    });

    it("rejects path traversal and separator characters", () => {
      expect(() => assertValidPipelineStageName(".")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("..")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("stage/1")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("stage\\1")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("../stage")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("stage..name")).toThrow(InvalidDslCallError);
    });

    it("rejects other unsafe characters", () => {
      expect(() => assertValidPipelineStageName("stage$")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("stage#1")).toThrow(InvalidDslCallError);
      expect(() => assertValidPipelineStageName("stage@abc")).toThrow(InvalidDslCallError);
    });
  });

  describe("createPipelineStageArtifactName", () => {
    it("returns stageName for valid names", () => {
      expect(createPipelineStageArtifactName("summarize")).toBe("summarize");
    });

    it("throws for invalid names", () => {
      expect(() => createPipelineStageArtifactName("sum/marize")).toThrow(InvalidDslCallError);
    });
  });

  describe("createPipelineAgentId", () => {
    it("creates correct deterministic agent ID without suffix", () => {
      const id = createPipelineAgentId({
        pipelineId: "pipeline-1",
        itemIndex: 0,
        stageName: "analyze"
      });
      expect(id).toBe("pipeline-1-item-0-analyze");
    });

    it("creates correct deterministic agent ID with suffix", () => {
      const id = createPipelineAgentId({
        pipelineId: "pipeline-1",
        itemIndex: 4,
        stageName: "summarize",
        suffix: "subtask-2"
      });
      expect(id).toBe("pipeline-1-item-4-summarize-subtask-2");
    });

    it("throws on invalid inputs", () => {
      expect(() => createPipelineAgentId({
        pipelineId: "",
        itemIndex: 0,
        stageName: "analyze"
      })).toThrow(InvalidDslCallError);

      expect(() => createPipelineAgentId({
        pipelineId: "pipeline-1",
        itemIndex: -1,
        stageName: "analyze"
      })).toThrow(InvalidDslCallError);

      expect(() => createPipelineAgentId({
        pipelineId: "pipeline-1",
        itemIndex: 0,
        stageName: "invalid/name"
      })).toThrow(InvalidDslCallError);

      expect(() => createPipelineAgentId({
        pipelineId: "pipeline-1",
        itemIndex: 0,
        stageName: "analyze",
        suffix: "invalid/suffix"
      })).toThrow(InvalidDslCallError);
    });
  });
});
