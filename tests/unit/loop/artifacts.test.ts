import { describe, expect, it, vi } from "vitest";
import {
  writeLoopDefinitionArtifact,
  writeRoundArtifacts,
  writeLoopHistoryArtifact,
  writeLoopResultArtifact
} from "../../../src/loop/artifacts.js";

describe("Loop Artifact Writers", () => {
  const mockStore = {
    writeJson: vi.fn().mockResolvedValue("path/to/artifact"),
    writeText: vi.fn(),
    appendText: vi.fn(),
    appendJsonl: vi.fn(),
    writeFinalReport: vi.fn(),
    updateManifest: vi.fn(),
    isRunCreated: vi.fn(),
    getRunArtifacts: vi.fn(),
    createRun: vi.fn(),
  };

  it("writes loop definition to correct path", async () => {
    await writeLoopDefinitionArtifact(mockStore as any, "loop-1", { options: {} });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/loop.json", { options: {} });
  });

  it("writes round artifacts to padded round directory", async () => {
    await writeRoundArtifacts(mockStore as any, "loop-2", 5, {
      round: { status: "completed" },
      stateBefore: { count: 0 },
      stateAfter: { count: 1 },
      result: { some: "large result" },
      nestedCalls: ["agent-1"]
    });

    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/round.json", { status: "completed" });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/state.before.json", { count: 0 });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/state.after.json", { count: 1 });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/result.preview.json", expect.anything());
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/nested-calls.json", ["agent-1"]);
  });

  it("skips optional round artifacts", async () => {
    vi.clearAllMocks();
    await writeRoundArtifacts(mockStore as any, "loop-3", 1, {
      round: {},
      stateBefore: {}
    });
    
    const paths = mockStore.writeJson.mock.calls.map(call => call[0]);
    expect(paths).not.toContain("loops/loop-3/rounds/0001/state.after.json");
    expect(paths).not.toContain("loops/loop-3/rounds/0001/result.preview.json");
    expect(paths).not.toContain("loops/loop-3/rounds/0001/error.json");
  });

  it("writes history and final result", async () => {
    await writeLoopHistoryArtifact(mockStore as any, "loop-1", []);
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/history.json", []);

    await writeLoopResultArtifact(mockStore as any, "loop-1", { status: "satisfied" } as any);
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/result.json", { status: "satisfied" });
  });
});
