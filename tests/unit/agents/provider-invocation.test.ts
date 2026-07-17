import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareProviderInvocation } from "../../../src/agents/provider-invocation.js";
import { runProcess } from "../../../src/agents/process-runner.js";
import { ErrorCode } from "../../../src/errors/codes.js";

const TEST_DIR = path.resolve("tests/temp-provider-invocation-test");

describe("provider invocation preparation", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("resolves a relative PATH entry once and pins the absolute real launcher for spawn", async () => {
    const binDir = path.join(TEST_DIR, "bin");
    const launcherPath = path.join(binDir, "provider-cli");
    const launcherBytes = "#!/bin/sh\nprintf provider-a";
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(launcherPath, launcherBytes, { mode: 0o755 });

    const preparation = await prepareProviderInvocation({
      provider: "gemini",
      command: {
        command: "provider-cli",
        args: ["--version"],
        cwd: TEST_DIR,
        env: { PATH: "bin" }
      },
      defaultCwd: TEST_DIR,
      secretValues: [],
      executionMode: "process",
      baseEnv: {},
      passEnv: []
    });

    expect(preparation.ok).toBe(true);
    if (!preparation.ok || !preparation.spawn) throw new Error("Expected a process spawn plan");
    const expectedRealPath = await fs.realpath(launcherPath);
    expect(preparation.spawn.command).toBe(expectedRealPath);
    expect(path.isAbsolute(preparation.spawn.command)).toBe(true);
    expect(preparation.evidence).toMatchObject({
      schemaVersion: "open-dynamic-workflow.provider-invocation.v2",
      provider: "gemini",
      executionMode: "process",
      requested: {
        command: "provider-cli",
        args: ["--version"],
        cwd: TEST_DIR,
        explicitEnvironmentKeys: ["PATH"]
      },
      resolution: { status: "resolved" },
      spawn: {
        command: expectedRealPath,
        args: ["--version"],
        cwd: TEST_DIR,
        environmentKeys: ["PATH"]
      },
      executableChain: {
        kind: "launcher",
        launcher: {
          requested: "provider-cli",
          resolvedPath: launcherPath,
          realPath: expectedRealPath,
          sha256: hash(launcherBytes)
        }
      }
    });
  });

  it.skipIf(process.platform === "win32")(
    "records and executes the complete Codex JavaScript launcher chain",
    async () => {
      const target = currentCodexTarget();
      const launcherDir = path.join(TEST_DIR, "node_modules", "@openai", "codex", "bin");
      const launcherPath = path.join(launcherDir, "codex.js");
      const commandBinDir = path.join(TEST_DIR, "command-bin");
      const commandPath = path.join(commandBinDir, "codex");
      const nodePath = path.join(commandBinDir, "node");
      const platformPackageDir = path.join(
        TEST_DIR,
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        ...target.platformPackage.split("/")
      );
      const nativePath = path.join(
        platformPackageDir,
        "vendor",
        target.targetTriple,
        "bin",
        "codex"
      );
      const nativeBytes = "#!/bin/sh\nprintf fixture-native-codex";
      const launcherBytes = codexLauncherFixture(target.targetTriple, target.platformPackage);

      await fs.mkdir(launcherDir, { recursive: true });
      await fs.mkdir(commandBinDir, { recursive: true });
      await fs.mkdir(path.dirname(nativePath), { recursive: true });
      await fs.writeFile(path.join(launcherDir, "..", "package.json"), JSON.stringify({
        name: "@openai/codex",
        version: "0.0.0",
        type: "module"
      }));
      await fs.writeFile(path.join(platformPackageDir, "package.json"), JSON.stringify({
        name: target.platformPackage,
        version: "0.0.0"
      }));
      await fs.writeFile(launcherPath, launcherBytes, { mode: 0o755 });
      await fs.writeFile(nativePath, nativeBytes, { mode: 0o755 });
      await fs.symlink(launcherPath, commandPath);
      await fs.symlink(process.execPath, nodePath);

      const preparation = await prepareProviderInvocation({
        provider: "codex",
        command: {
          command: "codex",
          args: ["exec", "--json"],
          cwd: TEST_DIR,
          env: { PATH: commandBinDir }
        },
        defaultCwd: TEST_DIR,
        secretValues: [],
        executionMode: "process",
        baseEnv: {},
        passEnv: []
      });

      expect(preparation.ok).toBe(true);
      if (!preparation.ok || !preparation.spawn) throw new Error("Expected a process spawn plan");
      const chain = preparation.evidence.executableChain;
      expect(chain?.kind).toBe("codex-js-launcher");
      if (chain?.kind !== "codex-js-launcher") throw new Error("Expected a Codex JS chain");

      expect(preparation.spawn.command).toBe(await fs.realpath(launcherPath));
      expect(chain).toMatchObject({
        kind: "codex-js-launcher",
        targetTriple: target.targetTriple,
        platformPackage: target.platformPackage,
        launcher: {
          requested: "codex",
          resolvedPath: commandPath,
          realPath: await fs.realpath(launcherPath),
          sha256: hash(launcherBytes)
        },
        env: {
          requested: "/usr/bin/env",
          resolvedPath: "/usr/bin/env",
          realPath: await fs.realpath("/usr/bin/env"),
          sha256: hash(await fs.readFile(await fs.realpath("/usr/bin/env")))
        },
        node: {
          requested: "node",
          resolvedPath: nodePath,
          realPath: await fs.realpath(process.execPath),
          sha256: hash(await fs.readFile(await fs.realpath(process.execPath)))
        },
        nativeCodex: {
          requested: `${target.platformPackage}/${target.targetTriple}/bin/codex`,
          resolvedPath: nativePath,
          realPath: await fs.realpath(nativePath),
          sha256: hash(nativeBytes)
        }
      });
      for (const executable of [chain.launcher, chain.env, chain.node, chain.nativeCodex]) {
        expect(path.isAbsolute(executable.realPath)).toBe(true);
        expect(executable.sha256).toMatch(/^[a-f0-9]{64}$/u);
      }

      const processResult = await runProcess({
        ...preparation.spawn,
        timeoutMs: 5000
      });
      expect(processResult.exitCode).toBe(0);
      expect(processResult.stdout).toBe("fixture-native-codex");
    }
  );

  it("uses Windows PATHEXT when resolving an extensionless provider command", async () => {
    const firstBinDir = path.join(TEST_DIR, "windows-bin-a");
    const secondBinDir = path.join(TEST_DIR, "windows-bin-b");
    const launcherPath = path.join(secondBinDir, "provider-cli.CMD");
    await fs.mkdir(firstBinDir, { recursive: true });
    await fs.mkdir(secondBinDir, { recursive: true });
    await fs.writeFile(launcherPath, "@echo off\r\necho provider", { mode: 0o644 });

    const preparation = await prepareProviderInvocation({
      provider: "gemini",
      command: {
        command: "provider-cli",
        args: [],
        cwd: TEST_DIR,
        env: {
          PATH: `${firstBinDir};${secondBinDir}`,
          PATHEXT: ".EXE;.CMD"
        }
      },
      defaultCwd: TEST_DIR,
      secretValues: [],
      executionMode: "process",
      baseEnv: {},
      passEnv: [],
      platform: "win32"
    });

    expect(preparation.ok).toBe(true);
    if (!preparation.ok || !preparation.spawn) throw new Error("Expected a Windows spawn plan");
    expect(preparation.spawn.command).toBe(await fs.realpath(launcherPath));
    expect(preparation.evidence.executableChain).toMatchObject({
      kind: "launcher",
      launcher: {
        requested: "provider-cli",
        resolvedPath: launcherPath,
        realPath: await fs.realpath(launcherPath),
        sha256: hash(await fs.readFile(launcherPath))
      }
    });
  });

  it.skipIf(process.platform === "win32")(
    "selects the Codex native target from the resolved Node binary architecture",
    async () => {
      const target = {
        targetTriple: "x86_64-unknown-linux-musl",
        platformPackage: "@openai/codex-linux-x64"
      };
      const launcherDir = path.join(TEST_DIR, "heterogeneous", "node_modules", "@openai", "codex", "bin");
      const launcherPath = path.join(launcherDir, "codex.js");
      const commandBinDir = path.join(TEST_DIR, "heterogeneous", "command-bin");
      const commandPath = path.join(commandBinDir, "codex");
      const nodePath = path.join(commandBinDir, "node");
      const platformPackageDir = path.join(
        TEST_DIR,
        "heterogeneous",
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        ...target.platformPackage.split("/")
      );
      const nativePath = path.join(
        platformPackageDir,
        "vendor",
        target.targetTriple,
        "bin",
        "codex"
      );
      await fs.mkdir(launcherDir, { recursive: true });
      await fs.mkdir(commandBinDir, { recursive: true });
      await fs.mkdir(path.dirname(nativePath), { recursive: true });
      await fs.writeFile(launcherPath, codexLauncherFixture(target.targetTriple, target.platformPackage), {
        mode: 0o755
      });
      await fs.writeFile(nodePath, fakeElfNode("x64"), { mode: 0o755 });
      await fs.writeFile(nativePath, "#!/bin/sh\nexit 0", { mode: 0o755 });
      await fs.writeFile(path.join(platformPackageDir, "package.json"), JSON.stringify({
        name: target.platformPackage,
        version: "0.0.0"
      }));
      await fs.symlink(launcherPath, commandPath);

      const preparation = await prepareProviderInvocation({
        provider: "codex",
        command: {
          command: "codex",
          args: [],
          cwd: TEST_DIR,
          env: { PATH: commandBinDir }
        },
        defaultCwd: TEST_DIR,
        secretValues: [],
        executionMode: "process",
        baseEnv: {},
        passEnv: [],
        platform: "linux"
      });

      expect(preparation.ok).toBe(true);
      if (!preparation.ok) throw new Error("Expected a resolved heterogeneous chain");
      expect(preparation.evidence.executableChain).toMatchObject({
        kind: "codex-js-launcher",
        targetTriple: target.targetTriple,
        platformPackage: target.platformPackage,
        node: {
          realPath: await fs.realpath(nodePath),
          sha256: hash(await fs.readFile(nodePath))
        },
        nativeCodex: {
          realPath: await fs.realpath(nativePath)
        }
      });
    }
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when the resolved Node architecture cannot be verified",
    async () => {
      const target = currentCodexTarget();
      const launcherPath = path.join(TEST_DIR, "unknown-node", "codex.js");
      const commandBinDir = path.join(TEST_DIR, "unknown-node", "bin");
      const commandPath = path.join(commandBinDir, "codex");
      const nodePath = path.join(commandBinDir, "node");
      await fs.mkdir(path.dirname(launcherPath), { recursive: true });
      await fs.mkdir(commandBinDir, { recursive: true });
      await fs.writeFile(launcherPath, codexLauncherFixture(target.targetTriple, target.platformPackage), {
        mode: 0o755
      });
      await fs.writeFile(nodePath, "#!/bin/sh\nexit 0", { mode: 0o755 });
      await fs.symlink(launcherPath, commandPath);

      const preparation = await prepareProviderInvocation({
        provider: "codex",
        command: {
          command: "codex",
          args: [],
          cwd: TEST_DIR,
          env: { PATH: commandBinDir }
        },
        defaultCwd: TEST_DIR,
        secretValues: [],
        executionMode: "process",
        baseEnv: {},
        passEnv: []
      });

      expect(preparation.ok).toBe(false);
      if (preparation.ok) throw new Error("Expected unverifiable Node architecture to fail");
      expect(preparation.error.code).toBe(ErrorCode.PROVIDER_INVOCATION_UNVERIFIABLE);
      expect(preparation.error.message).toContain("Node executable architecture could not be verified");
      expect(preparation.evidence.spawn).toBeNull();
    }
  );

  it("fails closed for an unrecognized Codex script and records the failed resolution", async () => {
    const launcherPath = path.join(TEST_DIR, "codex-wrapper");
    await fs.writeFile(launcherPath, "#!/usr/bin/env node\nconsole.log('not the official loader');\n", {
      mode: 0o755
    });

    const preparation = await prepareProviderInvocation({
      provider: "codex",
      command: {
        command: launcherPath,
        args: [],
        cwd: TEST_DIR,
        env: {}
      },
      defaultCwd: TEST_DIR,
      secretValues: [],
      executionMode: "process",
      baseEnv: process.env,
      passEnv: []
    });

    expect(preparation.ok).toBe(false);
    if (preparation.ok) throw new Error("Expected preparation to fail");
    expect(preparation.error.code).toBe(ErrorCode.PROVIDER_INVOCATION_UNVERIFIABLE);
    expect(preparation.evidence).toMatchObject({
      schemaVersion: "open-dynamic-workflow.provider-invocation.v2",
      executionMode: "process",
      resolution: {
        status: "failed",
        error: {
          code: ErrorCode.PROVIDER_INVOCATION_UNVERIFIABLE,
          message: expect.stringContaining("unrecognized script launcher")
        }
      },
      spawn: null,
      executableChain: null
    });
  });

  it("records non-process providers without claiming that a process was spawned", async () => {
    const preparation = await prepareProviderInvocation({
      provider: "mock",
      command: {
        command: "mock-process",
        args: ["agent-1"],
        cwd: TEST_DIR,
        env: {}
      },
      defaultCwd: TEST_DIR,
      secretValues: [],
      executionMode: "mock",
      baseEnv: process.env,
      passEnv: []
    });

    expect(preparation).toMatchObject({
      ok: true,
      evidence: {
        executionMode: "mock",
        resolution: { status: "not-applicable" },
        spawn: null,
        executableChain: null
      }
    });
  });
});

function currentCodexTarget(): { targetTriple: string; platformPackage: string } {
  if ((process.platform === "linux" || process.platform === "android") && process.arch === "x64") {
    return { targetTriple: "x86_64-unknown-linux-musl", platformPackage: "@openai/codex-linux-x64" };
  }
  if ((process.platform === "linux" || process.platform === "android") && process.arch === "arm64") {
    return { targetTriple: "aarch64-unknown-linux-musl", platformPackage: "@openai/codex-linux-arm64" };
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return { targetTriple: "x86_64-apple-darwin", platformPackage: "@openai/codex-darwin-x64" };
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return { targetTriple: "aarch64-apple-darwin", platformPackage: "@openai/codex-darwin-arm64" };
  }
  throw new Error(`Unsupported test platform: ${process.platform}/${process.arch}`);
}

function codexLauncherFixture(targetTriple: string, platformPackage: string): string {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const PLATFORM_PACKAGE_BY_TARGET = { ${JSON.stringify(targetTriple)}: ${JSON.stringify(platformPackage)} };
function findCodexExecutable() {
  const packageJsonPath = require.resolve(${JSON.stringify(`${platformPackage}/package.json`)});
  return path.join(path.dirname(packageJsonPath), "vendor", ${JSON.stringify(targetTriple)}, "bin", "codex");
}
const binaryPath = findCodexExecutable();
const child = spawn(binaryPath, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
void PLATFORM_PACKAGE_BY_TARGET;
`;
}

function fakeElfNode(architecture: "x64" | "arm64"): Buffer {
  const bytes = Buffer.alloc(64);
  bytes[0] = 0x7f;
  bytes[1] = 0x45;
  bytes[2] = 0x4c;
  bytes[3] = 0x46;
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(architecture === "x64" ? 62 : 183, 18);
  return bytes;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
