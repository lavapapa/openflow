import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLinuxBwrapArgs,
  buildMacSandboxProfile,
  createWorkspaceScopedPiTools,
  type WorkspaceScopedPiTool
} from "../../../src/security/workspace-scoped-pi-tools.js";

describe("workspace-scoped Pi tools", () => {
  it("allows workspace reads and writes while rejecting absolute and parent paths", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openflow-workspace-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "openflow-workspace-outside-"));
    await writeFile(join(workspace, "inside.txt"), "inside");
    await writeFile(join(outside, "secret.txt"), "secret");
    const tools = await createFileTestTools(workspace);
    const read = toolNamed(tools, "read");
    const write = toolNamed(tools, "write");

    await expect(callTool(read, { path: "inside.txt" })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("inside") }]
    });
    await expect(callTool(write, { path: "nested/new.txt", content: "created" })).resolves.toBeDefined();
    await expect(readFile(join(workspace, "nested/new.txt"), "utf8")).resolves.toBe("created");

    await expect(callTool(read, { path: join(outside, "secret.txt") })).rejects.toMatchObject({
      code: "SECURITY_POLICY_VIOLATION"
    });
    await expect(callTool(read, { path: "../secret.txt" })).rejects.toMatchObject({
      code: "SECURITY_POLICY_VIOLATION"
    });
    await expect(callTool(read, { path: "nested/../inside.txt" })).rejects.toMatchObject({
      code: "SECURITY_POLICY_VIOLATION"
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects reads and new writes through symlinks that leave the workspace",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "openflow-workspace-symlink-"));
      const outside = await mkdtemp(join(tmpdir(), "openflow-workspace-symlink-outside-"));
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(outside, join(workspace, "escape"));
      const tools = await createFileTestTools(workspace);

      await expect(callTool(toolNamed(tools, "read"), { path: "escape/secret.txt" }))
        .rejects.toBeDefined();
      await expect(callTool(toolNamed(tools, "write"), {
        path: "escape/created.txt",
        content: "must not escape"
      })).rejects.toMatchObject({ code: "SECURITY_POLICY_VIOLATION" });
      await expect(readFile(join(outside, "created.txt"), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    }
  );

  it("keeps find and ls inside the workspace when an external symlink is present", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openflow-workspace-search-"));
    const outside = await mkdtemp(join(tmpdir(), "openflow-workspace-search-outside-"));
    await mkdir(join(workspace, "docs"));
    await writeFile(join(workspace, "docs/inside.txt"), "inside");
    await writeFile(join(outside, "outside.txt"), "outside");
    if (process.platform !== "win32") {
      await symlink(outside, join(workspace, "external"));
    }
    const tools = await createFileTestTools(workspace);

    const findResult = await callTool(toolNamed(tools, "find"), {
      path: ".",
      pattern: "**/*.txt"
    });
    expect(resultText(findResult)).toContain("docs/inside.txt");
    expect(resultText(findResult)).not.toContain("outside.txt");

    const lsResult = await callTool(toolNamed(tools, "ls"), { path: "." });
    expect(resultText(lsResult)).toContain("docs/");
  });

  it("fails closed when the platform sandbox runtime is unavailable", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openflow-workspace-runtime-"));
    await expect(createWorkspaceScopedPiTools({
      cwd: workspace,
      platform: "linux",
      sandboxRuntime: join(workspace, "missing-bwrap")
    })).rejects.toMatchObject({
      code: "SECURITY_POLICY_VIOLATION",
      message: expect.stringContaining("requires bwrap")
    });
  });

  it("builds network-isolated sandbox policies with workspace-local environment paths", () => {
    const workspace = "/srv/xiaobai/run-1";
    const profile = buildMacSandboxProfile(workspace, ["/System", "/usr", "/bin"]);
    expect(profile).toContain("(deny default)");
    expect(profile).toContain(`(subpath \"${workspace}\")`);
    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("/etc");

    const args = buildLinuxBwrapArgs(
      "env",
      workspace,
      ["/usr", "/bin"],
      {
        HOME: `${workspace}/.openflow-sandbox/home`,
        TMPDIR: `${workspace}/.openflow-sandbox/tmp`,
        XDG_RUNTIME_DIR: `${workspace}/.openflow-sandbox/xdg-runtime`,
        PATH: "/usr/bin:/bin"
      }
    );
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--clearenv");
    expect(args).not.toContain("--share-net");
    expect(args).toContain("/workspace/.openflow-sandbox/home");
    expect(args).toContain("/workspace/.openflow-sandbox/tmp");
    expect(args).toContain("/workspace/.openflow-sandbox/xdg-runtime");
  });

  it.runIf(process.platform === "darwin")(
    "runs bash through sandbox-exec without host secrets or host filesystem reads",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "openflow-workspace-bash-"));
      process.env.XIAOBAI_TEST_SECRET = "must-not-enter-sandbox";
      try {
        const tools = await createWorkspaceScopedPiTools({ cwd: workspace });
        const result = await callTool(toolNamed(tools, "bash"), {
          command: [
            "printf 'HOME=%s\\n' \"$HOME\"",
            "printf 'SECRET=%s\\n' \"${XIAOBAI_TEST_SECRET-unset}\"",
            "if cat /etc/passwd >/dev/null 2>&1; then echo outside-readable; else echo outside-denied; fi"
          ].join("; ")
        });
        const text = resultText(result);
        expect(text).toContain(`HOME=${await realpath(workspace)}/.openflow-sandbox/home`);
        expect(text).toContain("SECRET=unset");
        expect(text).toContain("outside-denied");
        expect(text).not.toContain("must-not-enter-sandbox");
      } finally {
        delete process.env.XIAOBAI_TEST_SECRET;
      }
    }
  );
});

async function createFileTestTools(workspace: string): Promise<WorkspaceScopedPiTool[]> {
  return createWorkspaceScopedPiTools({
    cwd: workspace,
    platform: "linux",
    sandboxRuntime: process.execPath
  });
}

function toolNamed(tools: WorkspaceScopedPiTool[], name: string): WorkspaceScopedPiTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function callTool(tool: WorkspaceScopedPiTool, input: unknown): Promise<unknown> {
  return tool.execute(
    "test-call",
    input,
    new AbortController().signal,
    undefined,
    undefined
  );
}

function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((entry) => entry.text ?? "").join("\n");
}
