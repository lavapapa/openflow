import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { buildProviderEnv, redactProviderCommand, redactText } from "../security/env.js";
import type { ProviderCommand } from "../types/agent.js";
import type {
  ProviderExecutableChain,
  ProviderExecutableIdentity,
  ProviderInvocationEvidence
} from "../types/artifacts.js";

export type ProviderInvocationExecutionMode = "process" | "sdk" | "mock";

export interface ProviderInvocationPreparationInput {
  provider: string;
  command: ProviderCommand;
  defaultCwd: string;
  secretValues: string[];
  executionMode: ProviderInvocationExecutionMode;
  baseEnv: NodeJS.ProcessEnv;
  passEnv: string[];
  platform?: NodeJS.Platform | undefined;
  executableResolver?: ProviderExecutableResolver | undefined;
}

export interface ProviderProcessSpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string | undefined;
  env: Record<string, string>;
}

export type ProviderInvocationPreparation =
  | {
      ok: true;
      evidence: ProviderInvocationEvidence;
      spawn?: ProviderProcessSpawnPlan | undefined;
    }
  | {
      ok: false;
      evidence: ProviderInvocationEvidence;
      error: OpenDynamicWorkflowError;
    };

export interface ResolvedProviderExecutable {
  identity: ProviderExecutableIdentity;
  bytes: Buffer;
}

export interface ProviderExecutableResolutionRequest {
  requested: string;
  candidates: string[];
  platform: NodeJS.Platform;
}

export type ProviderExecutableResolver = (
  input: ProviderExecutableResolutionRequest
) => Promise<ResolvedProviderExecutable>;

const CODEX_PLATFORM_PACKAGE_BY_TARGET: Readonly<Record<string, string>> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64"
};

export async function prepareProviderInvocation(
  input: ProviderInvocationPreparationInput
): Promise<ProviderInvocationPreparation> {
  const redacted = redactProviderCommand(input.command, input.secretValues);
  const cwd = path.resolve(input.command.cwd ?? input.defaultCwd);
  const platform = input.platform ?? process.platform;
  const executableResolver = input.executableResolver ?? resolveExecutableFromFileSystem;
  const requested = {
    command: redacted.command,
    args: redacted.args,
    cwd,
    stdinSha256: sha256(input.command.stdin ?? ""),
    explicitEnvironmentKeys: Object.keys(input.command.env ?? {}).sort()
  };

  if (input.executionMode !== "process") {
    return {
      ok: true,
      evidence: {
        schemaVersion: "open-dynamic-workflow.provider-invocation.v2",
        provider: input.provider,
        executionMode: input.executionMode,
        requested,
        resolution: { status: "not-applicable" },
        spawn: null,
        executableChain: null
      }
    };
  }

  const env = buildProviderEnv({
    baseEnv: input.baseEnv,
    passEnv: input.passEnv,
    ...(input.command.env !== undefined ? { explicitEnv: input.command.env } : {})
  });

  try {
    const launcher = await resolveExecutable(
      input.command.command,
      cwd,
      env,
      platform,
      executableResolver
    );
    const executableChain = await resolveExecutableChain(
      input.provider,
      launcher,
      cwd,
      env,
      platform,
      executableResolver
    );
    const spawn: ProviderProcessSpawnPlan = {
      command: launcher.identity.realPath,
      args: [...input.command.args],
      cwd,
      env,
      ...(input.command.stdin !== undefined ? { stdin: input.command.stdin } : {})
    };
    return {
      ok: true,
      spawn,
      evidence: {
        schemaVersion: "open-dynamic-workflow.provider-invocation.v2",
        provider: input.provider,
        executionMode: "process",
        requested,
        resolution: { status: "resolved" },
        spawn: {
          command: spawn.command,
          args: redacted.args,
          cwd,
          environmentKeys: Object.keys(env).sort()
        },
        executableChain
      }
    };
  } catch (error) {
    const invocationError = normalizeInvocationError(error, input.secretValues);
    return {
      ok: false,
      error: invocationError,
      evidence: {
        schemaVersion: "open-dynamic-workflow.provider-invocation.v2",
        provider: input.provider,
        executionMode: "process",
        requested,
        resolution: {
          status: "failed",
          error: {
            code: invocationError.code,
            message: invocationError.message
          }
        },
        spawn: null,
        executableChain: null
      }
    };
  }
}

async function resolveExecutableChain(
  provider: string,
  launcher: ResolvedProviderExecutable,
  cwd: string,
  env: Record<string, string>,
  platform: NodeJS.Platform,
  executableResolver: ProviderExecutableResolver
): Promise<ProviderExecutableChain> {
  if (provider !== "codex") {
    return { kind: "launcher", launcher: launcher.identity };
  }

  if (isNativeExecutable(launcher.bytes)) {
    return { kind: "direct-native", launcher: launcher.identity };
  }

  const source = launcher.bytes.toString("utf8");
  if (!isRecognizedCodexJsLauncher(source)) {
    throw unverifiable(
      `Codex command resolved to an unrecognized script launcher: ${launcher.identity.realPath}. ` +
      "Use the official @openai/codex JavaScript launcher or point the provider directly at a native Codex executable."
    );
  }

  const envExecutable = await resolveAbsoluteExecutable(
    "/usr/bin/env",
    "/usr/bin/env",
    platform,
    executableResolver
  );
  const nodeExecutable = await resolveExecutable("node", cwd, env, platform, executableResolver);
  const nodeArchitecture = resolveNodeArchitecture(nodeExecutable, platform);
  const targetTriple = resolveCodexTargetTriple(platform, nodeArchitecture);
  const platformPackage = CODEX_PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  if (!platformPackage
    || !source.includes(JSON.stringify(targetTriple))
    || !source.includes(JSON.stringify(platformPackage))) {
    throw unverifiable(
      `Codex JavaScript launcher does not declare the executable target selected by its resolved Node runtime: ` +
      `${targetTriple} (${platformPackage ?? "unknown package"}).`
    );
  }
  const nativeCodex = await resolveCodexNativeExecutable(
    launcher.identity.realPath,
    targetTriple,
    platformPackage,
    platform,
    executableResolver
  );

  return {
    kind: "codex-js-launcher",
    launcher: launcher.identity,
    env: envExecutable.identity,
    node: nodeExecutable.identity,
    nativeCodex: nativeCodex.identity,
    targetTriple,
    platformPackage
  };
}

function isRecognizedCodexJsLauncher(source: string): boolean {
  const firstLine = source.split(/\r?\n/u, 1)[0];
  if (firstLine !== "#!/usr/bin/env node") return false;

  const requiredMarkers = [
    "createRequire",
    "PLATFORM_PACKAGE_BY_TARGET",
    "findCodexExecutable",
    "const binaryPath = findCodexExecutable()",
    "spawn(binaryPath"
  ];
  return requiredMarkers.every((marker) => source.includes(marker));
}

async function resolveCodexNativeExecutable(
  launcherRealPath: string,
  targetTriple: string,
  platformPackage: string,
  platform: NodeJS.Platform,
  executableResolver: ProviderExecutableResolver
): Promise<ResolvedProviderExecutable> {
  const launcherDir = path.dirname(launcherRealPath);
  let vendorRoot: string;
  try {
    const requireFromLauncher = createRequire(launcherRealPath);
    const packageJsonPath = requireFromLauncher.resolve(`${platformPackage}/package.json`);
    vendorRoot = path.join(path.dirname(packageJsonPath), "vendor");
  } catch {
    vendorRoot = path.join(launcherDir, "..", "vendor");
  }

  const executableName = platform === "win32" ? "codex.exe" : "codex";
  const candidate = path.resolve(vendorRoot, targetTriple, "bin", executableName);
  return resolveAbsoluteExecutable(
    candidate,
    `${platformPackage}/${targetTriple}/bin/${executableName}`,
    platform,
    executableResolver
  );
}

function resolveCodexTargetTriple(platform: NodeJS.Platform, arch: string): string {
  if ((platform === "linux" || platform === "android") && arch === "x64") {
    return "x86_64-unknown-linux-musl";
  }
  if ((platform === "linux" || platform === "android") && arch === "arm64") {
    return "aarch64-unknown-linux-musl";
  }
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  throw unverifiable(`Codex executable chain is unsupported on ${platform}/${arch}.`);
}

function resolveNodeArchitecture(
  nodeExecutable: ResolvedProviderExecutable,
  platform: NodeJS.Platform
): "x64" | "arm64" {
  const architectures = platform === "darwin"
    ? readMachOArchitectures(nodeExecutable.bytes)
    : platform === "linux" || platform === "android"
      ? readElfArchitectures(nodeExecutable.bytes)
      : platform === "win32"
        ? readPeArchitectures(nodeExecutable.bytes)
        : [];

  if (architectures.length === 1) return architectures[0]!;
  if (architectures.length > 1) {
    throw unverifiable(
      `Resolved Node executable contains multiple architectures and its runtime selection cannot be proven: ` +
      `${nodeExecutable.identity.realPath} (${architectures.join(", ")}).`
    );
  }
  throw unverifiable(
    `Resolved Node executable architecture could not be verified for ${platform}: ` +
    nodeExecutable.identity.realPath
  );
}

function readElfArchitectures(bytes: Buffer): Array<"x64" | "arm64"> {
  if (bytes.length < 20
    || bytes[0] !== 0x7f
    || bytes[1] !== 0x45
    || bytes[2] !== 0x4c
    || bytes[3] !== 0x46) {
    return [];
  }
  const endianness = bytes[5];
  if (endianness !== 1 && endianness !== 2) return [];
  const machine = endianness === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
  if (machine === 62) return ["x64"];
  if (machine === 183) return ["arm64"];
  return [];
}

function readMachOArchitectures(bytes: Buffer): Array<"x64" | "arm64"> {
  if (bytes.length < 8) return [];
  const magic = bytes.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) {
    const littleEndian = magic === 0xcefaedfe || magic === 0xcffaedfe;
    const cpuType = littleEndian ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
    const architecture = machOCpuType(cpuType);
    return architecture ? [architecture] : [];
  }

  const fatFormats: Readonly<Record<number, { littleEndian: boolean; entrySize: number }>> = {
    [0xcafebabe]: { littleEndian: false, entrySize: 20 },
    [0xbebafeca]: { littleEndian: true, entrySize: 20 },
    [0xcafebabf]: { littleEndian: false, entrySize: 32 },
    [0xbfbafeca]: { littleEndian: true, entrySize: 32 }
  };
  const format = fatFormats[magic];
  if (!format) return [];
  const count = format.littleEndian ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
  if (count > 32 || bytes.length < 8 + count * format.entrySize) return [];

  const architectures = new Set<"x64" | "arm64">();
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * format.entrySize;
    const cpuType = format.littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const architecture = machOCpuType(cpuType);
    if (architecture) architectures.add(architecture);
  }
  return [...architectures];
}

function machOCpuType(cpuType: number): "x64" | "arm64" | null {
  if (cpuType === 0x01000007) return "x64";
  if (cpuType === 0x0100000c) return "arm64";
  return null;
}

function readPeArchitectures(bytes: Buffer): Array<"x64" | "arm64"> {
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return [];
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 6 > bytes.length
    || bytes[peOffset] !== 0x50
    || bytes[peOffset + 1] !== 0x45
    || bytes[peOffset + 2] !== 0
    || bytes[peOffset + 3] !== 0) {
    return [];
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  if (machine === 0x8664) return ["x64"];
  if (machine === 0xaa64) return ["arm64"];
  return [];
}

async function resolveExecutable(
  requested: string,
  cwd: string,
  env: Record<string, string>,
  platform: NodeJS.Platform,
  executableResolver: ProviderExecutableResolver
): Promise<ResolvedProviderExecutable> {
  const candidates = executableCandidates(requested, cwd, env, platform);
  return executableResolver({ requested, candidates, platform });
}

function executableCandidates(
  requested: string,
  cwd: string,
  env: Record<string, string>,
  platform: NodeJS.Platform
): string[] {
  if (path.isAbsolute(requested)) {
    return expandWindowsExecutableExtensions([path.resolve(requested)], requested, env, platform);
  }
  if (requested.includes("/") || requested.includes("\\")) {
    return expandWindowsExecutableExtensions([path.resolve(cwd, requested)], requested, env, platform);
  }

  const pathValue = getEnvironmentValue(env, "PATH");
  if (!pathValue) return [];
  const baseCandidates = pathValue
    .split(platform === "win32" ? ";" : path.delimiter)
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(cwd, entry, requested));
  return expandWindowsExecutableExtensions(baseCandidates, requested, env, platform);
}

function expandWindowsExecutableExtensions(
  candidates: string[],
  requested: string,
  env: Record<string, string>,
  platform: NodeJS.Platform
): string[] {
  if (platform !== "win32" || path.extname(requested).length > 0) return candidates;
  const pathExt = getEnvironmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt.split(";").map((extension) => extension.trim()).filter(Boolean);
  return [...new Set(candidates.flatMap((candidate) => [
    candidate,
    ...extensions.map((extension) => `${candidate}${extension}`)
  ]))];
}

async function resolveAbsoluteExecutable(
  candidate: string,
  requested: string = candidate,
  platform: NodeJS.Platform = process.platform,
  executableResolver: ProviderExecutableResolver = resolveExecutableFromFileSystem
): Promise<ResolvedProviderExecutable> {
  return executableResolver({ requested, candidates: [path.resolve(candidate)], platform });
}

async function resolveExecutableFromFileSystem(
  input: ProviderExecutableResolutionRequest
): Promise<ResolvedProviderExecutable> {
  for (const candidate of input.candidates) {
    try {
      const realPath = await fs.realpath(candidate);
      const stats = await fs.stat(realPath);
      if (!stats.isFile()) continue;
      if (input.platform !== "win32") await fs.access(realPath, fsConstants.X_OK);
      const bytes = await fs.readFile(realPath);
      return {
        identity: {
          requested: input.requested,
          resolvedPath: path.resolve(candidate),
          realPath: path.resolve(realPath),
          sha256: sha256(bytes)
        },
        bytes
      };
    } catch {
      // Continue through the exact candidate list derived from the spawn environment.
    }
  }
  throw unverifiable(
    `Provider executable could not be resolved to an executable regular file: ${input.requested}. ` +
    "The invocation was not spawned because its executable identity could not be recorded."
  );
}

function getEnvironmentValue(env: Record<string, string>, name: string): string | undefined {
  const direct = env[name];
  if (direct !== undefined) return direct;
  const matchingKey = Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase());
  return matchingKey === undefined ? undefined : env[matchingKey];
}

function isNativeExecutable(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return true;
  }
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true;

  const magic = bytes.readUInt32BE(0);
  return new Set([
    0xfeedface,
    0xcefaedfe,
    0xfeedfacf,
    0xcffaedfe,
    0xcafebabe,
    0xbebafeca,
    0xcafebabf,
    0xbfbafeca
  ]).has(magic);
}

function normalizeInvocationError(error: unknown, secretValues: string[]): OpenDynamicWorkflowError {
  if (error instanceof OpenDynamicWorkflowError) {
    return new OpenDynamicWorkflowError(error.code, redactText(error.message, secretValues), {
      cause: error
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return unverifiable(redactText(message, secretValues));
}

function unverifiable(message: string): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(ErrorCode.PROVIDER_INVOCATION_UNVERIFIABLE, message);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
