import { describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { 
  isPathLikeWorkflowTarget, 
  resolveWorkflowTarget 
} from "../../../src/workflow/resolve-target.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import type { ResolvedOpenFlowConfig } from "../../../src/config/types.js";

const FIXTURES_DIR = resolve(__dirname, "../../fixtures/workflows/resolve-target");

function createTestConfig(cwd: string): ResolvedOpenFlowConfig {
  return {
    ...DEFAULT_CONFIG,
    cwd,
    outDir: join(cwd, "out"),
    cliArgs: {},
    workflow: {
      discovery: {
        include: ["**/*.ts"]
      },
      maxDepth: 8
    }
  } as ResolvedOpenFlowConfig;
}

describe("Workflow Target Resolver", () => {
  describe("isPathLikeWorkflowTarget", () => {
    it("identifies absolute paths", () => {
      expect(isPathLikeWorkflowTarget("/abs/path/to/wf.ts")).toBe(true);
      expect(isPathLikeWorkflowTarget("C:\\abs\\path\\to\\wf.ts")).toBe(true);
    });

    it("identifies paths with slashes", () => {
      expect(isPathLikeWorkflowTarget("rel/path/to/wf.ts")).toBe(true);
      expect(isPathLikeWorkflowTarget("rel\\path\\to\\wf.ts")).toBe(true);
    });

    it("identifies paths starting with ./ or ../", () => {
      expect(isPathLikeWorkflowTarget("./wf.ts")).toBe(true);
      expect(isPathLikeWorkflowTarget("../wf.ts")).toBe(true);
    });

    it("identifies paths ending with known extensions", () => {
      expect(isPathLikeWorkflowTarget("wf.ts")).toBe(true);
      expect(isPathLikeWorkflowTarget("wf.js")).toBe(true);
      expect(isPathLikeWorkflowTarget("wf.mts")).toBe(true);
      expect(isPathLikeWorkflowTarget("wf.mjs")).toBe(true);
    });

    it("identifies bare names as NOT path-like", () => {
      expect(isPathLikeWorkflowTarget("review")).toBe(false);
      expect(isPathLikeWorkflowTarget("my-workflow")).toBe(false);
    });
  });

  describe("resolveWorkflowTarget", () => {
    it("resolves by exact workflow name", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      const result = await resolveWorkflowTarget({
        target: "review",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      });

      expect(result.targetKind).toBe("workflow-name");
      expect(result.workflowName).toBe("review");
      expect(result.workflowFile).toBe(join(FIXTURES_DIR, "review.ts"));
      expect(result.discoverySource).toBe("list-discovery");
    });

    it("matches case-sensitively", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      
      const resultLower = await resolveWorkflowTarget({
        target: "review",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      });
      expect(resultLower.workflowName).toBe("review");

      const resultUpper = await resolveWorkflowTarget({
        target: "Review",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      });
      expect(resultUpper.workflowName).toBe("Review");
      expect(resultUpper.workflowFile).toBe(join(FIXTURES_DIR, "Review-Case.ts"));
    });

    it("falls back to file path if no name matches", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      // "review.ts" is a file, but not a workflow name (name is "review")
      const result = await resolveWorkflowTarget({
        target: "review.ts",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      });

      expect(result.targetKind).toBe("workflow-file");
      expect(result.workflowFile).toBe(join(FIXTURES_DIR, "review.ts"));
      expect(result.discoverySource).toBe("file-path");
      expect(result.candidatePaths).toBeUndefined();
    });

    it("throws duplicate-name error when multiple workflows have same name", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      await expect(resolveWorkflowTarget({
        target: "duplicate",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      })).rejects.toThrow(/Multiple workflows found with name "duplicate"/);
    });

    it("throws WORKFLOW_TARGET_NOT_FOUND if name and file path fail", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      await expect(resolveWorkflowTarget({
        target: "non-existent",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      })).rejects.toThrow(/not found by name or file path/);
    });

    it("throws WORKFLOW_DISCOVERY_FAILED if discovery fails due to non-existent directory", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      config.workflow.discovery.include = ["non-existent-directory/**/*.ts"];

      let err: any = null;
      try {
        await resolveWorkflowTarget({
          target: "review",
          cwd: FIXTURES_DIR,
          config,
          mode: "run"
        });
      } catch (e) {
        err = e;
      }

      expect(err).not.toBeNull();
      expect(err.code).toBe("WORKFLOW_DISCOVERY_FAILED");
      expect(err.message).toContain("Could not resolve workflow target");
      expect(err.message).toContain("non-existent-directory");
    });

    it("does NOT execute workflow modules during resolution", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      // throw-if-executed.ts contains top-level throw
      const result = await resolveWorkflowTarget({
        target: "throw-if-executed",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      });

      expect(result.workflowName).toBe("throw-if-executed");
      expect(result.targetKind).toBe("workflow-name");
    });

    it("respects --cwd through config", async () => {
      const otherCwd = resolve(FIXTURES_DIR, "..");
      const config = createTestConfig(otherCwd);
      
      // Target is relative to FIXTURES_DIR, so from otherCwd it should be "resolve-target/review.ts"
      const result = await resolveWorkflowTarget({
        target: "resolve-target/review.ts",
        cwd: otherCwd,
        config,
        mode: "run"
      });

      expect(result.workflowFile).toBe(join(FIXTURES_DIR, "review.ts"));
    });

    it("returns candidatePaths including only unique or targeted workflows", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      const result = await resolveWorkflowTarget({
        target: "review",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      });

      expect(result.candidatePaths).toBeDefined();
      expect(result.candidatePaths).toContain(join(FIXTURES_DIR, "review.ts"));
      expect(result.candidatePaths).toContain(join(FIXTURES_DIR, "Review-Case.ts"));
      expect(result.candidatePaths).toContain(join(FIXTURES_DIR, "throw-if-executed.ts"));
      // Duplicates are excluded to avoid registry collisions for unrelated workflows
      expect(result.candidatePaths).not.toContain(join(FIXTURES_DIR, "duplicate-1.ts"));
      expect(result.candidatePaths).not.toContain(join(FIXTURES_DIR, "duplicate-2.ts"));
    });

    it("fails on empty target", async () => {
      const config = createTestConfig(FIXTURES_DIR);
      await expect(resolveWorkflowTarget({
        target: "",
        cwd: FIXTURES_DIR,
        config,
        mode: "run"
      })).rejects.toThrow(/Workflow target is required/);
    });

    it("enforces workspace path containment policy", async () => {
      // 1. Create a temporary workspace directory and an outside directory.
      const baseTmpDir = await mkdtemp(join(tmpdir(), "openflow-test-"));
      const workspaceDir = join(baseTmpDir, "workspace");
      const outsideDir = join(baseTmpDir, "outside");
      await mkdir(workspaceDir);
      await mkdir(outsideDir);

      try {
        const config = createTestConfig(workspaceDir);

        // 2. Write a valid workflow file in the outside directory.
        const outsideWfPath = join(outsideDir, "outside-wf.ts");
        await writeFile(
          outsideWfPath,
          `export const meta = { name: "outside", description: "outside" };\nexport default function() {}`
        );

        // 3. Write a valid workflow file in the workspace directory.
        const insideWfPath = join(workspaceDir, "inside-wf.ts");
        await writeFile(
          insideWfPath,
          `export const meta = { name: "inside", description: "inside" };\nexport default function() {}`
        );

        // 4. Resolving the normal in-workspace file target should succeed
        const insideResult = await resolveWorkflowTarget({
          target: insideWfPath,
          cwd: workspaceDir,
          config,
          mode: "run",
        });
        expect(insideResult.targetKind).toBe("workflow-file");
        expect(insideResult.workflowFile).toBe(insideWfPath);

        // 5. Resolving the outside file target should throw SECURITY_POLICY_VIOLATION
        let securityErr: any = null;
        try {
          await resolveWorkflowTarget({
            target: outsideWfPath,
            cwd: workspaceDir,
            config,
            mode: "run",
          });
        } catch (err) {
          securityErr = err;
        }
        expect(securityErr).not.toBeNull();
        expect(securityErr.code).toBe("SECURITY_POLICY_VIOLATION");

        // 6. Symlink check
        const symlinkPath = join(workspaceDir, "symlinked-outside-wf.ts");
        let symlinkCreated = false;
        try {
          await symlink(outsideWfPath, symlinkPath);
          symlinkCreated = true;
        } catch {
          // Skip symlink assertion on platforms where symlink creation is unavailable (e.g. some Windows setups)
        }

        if (symlinkCreated) {
          let symlinkErr: any = null;
          try {
            await resolveWorkflowTarget({
              target: symlinkPath,
              cwd: workspaceDir,
              config,
              mode: "run",
            });
          } catch (err) {
            symlinkErr = err;
          }
          expect(symlinkErr).not.toBeNull();
          expect(symlinkErr.code).toBe("SECURITY_POLICY_VIOLATION");
        }
      } finally {
        await rm(baseTmpDir, { recursive: true, force: true });
      }
    });
  });
});
