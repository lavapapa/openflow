import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile
} from "node:fs/promises";
import * as path from "node:path";
import type {
  BashOperations,
  EditOperations,
  FindOperations,
  GrepOperations,
  LsOperations,
  ReadOperations,
  WriteOperations
} from "@earendil-works/pi-coding-agent";
import { glob } from "glob";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";

const SCOPED_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const SANDBOX_STATE_DIR = ".openflow-sandbox";

export interface WorkspaceScopedPiTool {
  name: string;
  execute: (...args: any[]) => Promise<unknown>;
}

export interface WorkspaceScopedPiToolsOptions {
  cwd: string;
  platform?: NodeJS.Platform | undefined;
  sandboxRuntime?: string | undefined;
  runtimeReadOnlyPaths?: string[] | undefined;
}

export interface WorkspaceScopedPiToolFactoryContext {
  cwd: string;
}

export type WorkspaceScopedPiToolFactory = (
  context: WorkspaceScopedPiToolFactoryContext
) => Promise<WorkspaceScopedPiTool[]>;

export type WorkspaceScopedPiToolFactoryDefaults = Omit<WorkspaceScopedPiToolsOptions, "cwd">;

/**
 * Create Pi's standard coding tools with workspace-confined filesystem and shell operations.
 * The factory is async because it verifies the workspace and sandbox runtime before exposing tools.
 */
export async function createWorkspaceScopedPiTools(
  options: WorkspaceScopedPiToolsOptions
): Promise<WorkspaceScopedPiTool[]> {
  const guard = await WorkspacePathGuard.create(options.cwd);
  const pi = await loadPiToolApi();
  const operations = createWorkspaceFileOperations(guard);
  const bashOperations = await createWorkspaceSandboxBashOperations({
    cwd: guard.root,
    platform: options.platform,
    sandboxRuntime: options.sandboxRuntime,
    runtimeReadOnlyPaths: options.runtimeReadOnlyPaths
  });

  return [
    wrapPathTool(pi.createReadTool(guard.root, { operations: operations.read }), guard, true),
    pi.createBashTool(guard.root, { operations: bashOperations }),
    wrapPathTool(pi.createEditTool(guard.root, { operations: operations.edit }), guard, true),
    wrapPathTool(pi.createWriteTool(guard.root, { operations: operations.write }), guard, true),
    wrapPathTool(pi.createGrepTool(guard.root, { operations: operations.grep }), guard, false),
    wrapPathTool(pi.createFindTool(guard.root, { operations: operations.find }), guard, false),
    wrapPathTool(pi.createLsTool(guard.root, { operations: operations.ls }), guard, false)
  ];
}

/** Build a reusable per-cwd factory for host applications such as xiaobai-agent. */
export function createWorkspaceScopedPiToolFactory(
  defaults: WorkspaceScopedPiToolFactoryDefaults = {}
): WorkspaceScopedPiToolFactory {
  return ({ cwd }) => createWorkspaceScopedPiTools({ ...defaults, cwd });
}

export function assertNoScopedToolOverrides(tools: WorkspaceScopedPiTool[]): void {
  const conflict = tools.find((tool) => SCOPED_TOOL_NAMES.has(tool.name));
  if (conflict) {
    throw securityViolation(
      `Host custom tool '${conflict.name}' cannot override a workspace-scoped built-in tool.`
    );
  }
}

interface WorkspaceFileOperations {
  read: ReadOperations;
  edit: EditOperations;
  write: WriteOperations;
  grep: GrepOperations;
  find: FindOperations;
  ls: LsOperations;
}

function createWorkspaceFileOperations(guard: WorkspacePathGuard): WorkspaceFileOperations {
  return {
    read: {
      access: async (candidate) => {
        const safePath = await guard.assertExisting(candidate);
        await access(safePath, constants.R_OK);
      },
      readFile: async (candidate) => readFile(await guard.assertExisting(candidate))
    },
    edit: {
      access: async (candidate) => {
        const safePath = await guard.assertExisting(candidate);
        await access(safePath, constants.R_OK | constants.W_OK);
      },
      readFile: async (candidate) => readFile(await guard.assertExisting(candidate)),
      writeFile: async (candidate, content) => {
        await writeFile(await guard.assertCreatable(candidate), content, "utf8");
      }
    },
    write: {
      mkdir: async (candidate) => {
        await guard.assertCreatable(candidate);
        await mkdir(candidate, { recursive: true });
        await guard.assertExisting(candidate);
      },
      writeFile: async (candidate, content) => {
        await writeFile(await guard.assertCreatable(candidate), content, "utf8");
      }
    },
    grep: {
      isDirectory: async (candidate) => (await stat(await guard.assertExisting(candidate))).isDirectory(),
      readFile: async (candidate) => readFile(await guard.assertExisting(candidate), "utf8")
    },
    find: {
      exists: async (candidate) => guard.exists(candidate),
      glob: async (pattern, cwd, options) => {
        const safeCwd = await guard.assertExisting(cwd);
        const matches = await glob(pattern, {
          cwd: safeCwd,
          absolute: true,
          dot: true,
          follow: false,
          ignore: options.ignore
        });
        const safeMatches: string[] = [];
        for (const match of matches) {
          if (safeMatches.length >= options.limit) break;
          try {
            safeMatches.push(await guard.assertExisting(match));
          } catch (error) {
            if (!isSecurityViolation(error)) throw error;
          }
        }
        return safeMatches;
      }
    },
    ls: {
      exists: async (candidate) => guard.exists(candidate),
      stat: async (candidate) => stat(await guard.assertExisting(candidate)),
      readdir: async (candidate) => readdir(await guard.assertExisting(candidate))
    }
  };
}

class WorkspacePathGuard {
  readonly root: string;
  private readonly rootRealPath: string;

  private constructor(root: string, rootRealPath: string) {
    this.root = root;
    this.rootRealPath = rootRealPath;
  }

  static async create(cwd: string): Promise<WorkspacePathGuard> {
    const root = path.resolve(cwd);
    const rootRealPath = await realpath(root).catch((cause) => {
      throw securityViolation(`Workspace does not exist or cannot be resolved: ${root}`, cause);
    });
    const rootStat = await stat(rootRealPath);
    if (!rootStat.isDirectory()) {
      throw securityViolation(`Workspace is not a directory: ${root}`);
    }
    return new WorkspacePathGuard(root, rootRealPath);
  }

  assertRawToolPath(candidate: unknown, required: boolean): void {
    if (candidate === undefined && !required) return;
    if (typeof candidate !== "string" || candidate.length === 0) {
      throw securityViolation("Tool path must be a non-empty relative path.");
    }
    const normalizedCandidate = candidate.startsWith("@") ? candidate.slice(1) : candidate;
    if (
      path.isAbsolute(normalizedCandidate) ||
      path.win32.isAbsolute(normalizedCandidate) ||
      normalizedCandidate === "~" ||
      normalizedCandidate.startsWith("~/") ||
      normalizedCandidate.startsWith("~\\")
    ) {
      throw securityViolation(`Absolute and home-relative paths are not allowed: ${candidate}`);
    }
    if (normalizedCandidate.split(/[\\/]+/u).includes("..")) {
      throw securityViolation(`Parent path segments are not allowed: ${candidate}`);
    }
    this.assertLexicalContainment(path.resolve(this.root, normalizedCandidate));
  }

  async assertExisting(candidate: string): Promise<string> {
    const lexicalPath = this.assertLexicalContainment(candidate);
    const resolvedPath = await realpath(lexicalPath).catch((cause) => {
      throw securityViolation(`Workspace path does not exist or cannot be resolved: ${lexicalPath}`, cause);
    });
    this.assertRealContainment(resolvedPath);
    return lexicalPath;
  }

  async assertCreatable(candidate: string): Promise<string> {
    const lexicalPath = this.assertLexicalContainment(candidate);
    let cursor = lexicalPath;
    while (true) {
      const entry = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (entry) {
        const resolvedPath = await realpath(cursor).catch((cause) => {
          throw securityViolation(`Workspace path contains an unresolved symlink: ${cursor}`, cause);
        });
        this.assertRealContainment(resolvedPath);
        return lexicalPath;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw securityViolation(`Cannot find an existing parent inside workspace: ${lexicalPath}`);
      }
      cursor = parent;
    }
  }

  async exists(candidate: string): Promise<boolean> {
    const lexicalPath = this.assertLexicalContainment(candidate);
    try {
      await this.assertExisting(lexicalPath);
      return true;
    } catch (error) {
      if (isMissingPath(error)) return false;
      throw error;
    }
  }

  private assertLexicalContainment(candidate: string): string {
    const absolutePath = path.resolve(candidate);
    if (!isPathInside(this.root, absolutePath)) {
      throw securityViolation(`Path escapes workspace: ${candidate}`);
    }
    return absolutePath;
  }

  private assertRealContainment(candidate: string): void {
    if (!isPathInside(this.rootRealPath, candidate)) {
      throw securityViolation(`Resolved path escapes workspace: ${candidate}`);
    }
  }
}

function wrapPathTool<T extends WorkspaceScopedPiTool>(
  tool: T,
  guard: WorkspacePathGuard,
  required: boolean
): T {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(...args: any[]): Promise<unknown> {
      const input = args[1] as { path?: unknown } | undefined;
      guard.assertRawToolPath(input?.path, required);
      return execute(...args);
    }
  } as T;
}

interface WorkspaceSandboxBashOptions extends WorkspaceScopedPiToolsOptions {}

export async function createWorkspaceSandboxBashOperations(
  options: WorkspaceSandboxBashOptions
): Promise<BashOperations> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    throw securityViolation(`workspace-full-access is not supported on platform '${platform}'.`);
  }
  const workspace = await realpath(path.resolve(options.cwd));
  const runtime = await resolveSandboxRuntime(platform, options.sandboxRuntime);
  const runtimeReadOnlyPaths = resolveRuntimeReadOnlyPaths(platform, options.runtimeReadOnlyPaths);

  return {
    exec: async (command, cwd, execution) => {
      const commandCwd = await realpath(path.resolve(cwd));
      if (!isPathInside(workspace, commandCwd)) {
        throw securityViolation(`Bash cwd escapes workspace: ${cwd}`);
      }
      await prepareSandboxState(workspace);
      const sandboxEnv = buildSandboxEnvironment(workspace, platform, execution.env);
      const invocation = platform === "darwin"
        ? {
            command: runtime,
            args: [
              "-p",
              buildMacSandboxProfile(workspace, runtimeReadOnlyPaths),
              "/bin/sh",
              "-c",
              command
            ],
            env: sandboxEnv
          }
        : {
            command: runtime,
            args: buildLinuxBwrapArgs(command, workspace, runtimeReadOnlyPaths, sandboxEnv),
            env: sandboxEnv
          };

      return spawnSandboxedCommand(invocation, workspace, execution);
    }
  };
}

export function buildMacSandboxProfile(workspace: string, runtimeReadOnlyPaths: string[]): string {
  const readRules = runtimeReadOnlyPaths
    .map((entry) => `  (subpath ${quoteSandboxValue(entry)})`)
    .join("\n");
  return [
    "(version 1)",
    "(deny default)",
    "(deny network*)",
    "(import \"dyld-support.sb\")",
    "(allow process*)",
    "(allow syscall*)",
    "(allow mach-bootstrap)",
    "(allow mach-register)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read* file-test-existence",
    readRules,
    `  (subpath ${quoteSandboxValue(workspace)})`,
    "  (literal \"/private/var/select/sh\")",
    "  (literal \"/dev/null\")",
    "  (literal \"/dev/urandom\")",
    ")",
    "(allow file-read-metadata file-test-existence",
    `  (path-ancestors ${quoteSandboxValue(workspace)})`,
    ")",
    "(allow file-write* file-test-existence",
    `  (subpath ${quoteSandboxValue(workspace)})`,
    "  (literal \"/dev/null\")",
    ")"
  ].join("\n");
}

export function buildLinuxBwrapArgs(
  command: string,
  workspace: string,
  runtimeReadOnlyPaths: string[],
  environment: NodeJS.ProcessEnv
): string[] {
  const sandboxWorkspace = "/workspace";
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--proc",
    "/proc",
    "--dev",
    "/dev"
  ];
  for (const runtimePath of runtimeReadOnlyPaths) {
    args.push("--ro-bind", runtimePath, runtimePath);
  }
  args.push("--bind", workspace, sandboxWorkspace, "--chdir", sandboxWorkspace);
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) {
      args.push("--setenv", name, translateWorkspaceEnvPath(value, workspace, sandboxWorkspace));
    }
  }
  args.push("/bin/sh", "-c", command);
  return args;
}

async function spawnSandboxedCommand(
  invocation: { command: string; args: string[]; env: NodeJS.ProcessEnv },
  cwd: string,
  execution: {
    onData: (data: Buffer) => void;
    signal?: AbortSignal | undefined;
    timeout?: number | undefined;
  }
): Promise<{ exitCode: number | null }> {
  if (execution.signal?.aborted) throw new Error("aborted");

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      detached: true,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let settled = false;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      execution.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const terminate = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    const onAbort = () => terminate();

    child.stdout?.on("data", execution.onData);
    child.stderr?.on("data", execution.onData);
    child.on("error", (error) => settle(() => reject(error)));
    child.on("close", (code) => {
      if (execution.signal?.aborted) {
        settle(() => reject(new Error("aborted")));
      } else if (timedOut) {
        settle(() => reject(new Error(`timeout:${execution.timeout}`)));
      } else {
        settle(() => resolve({ exitCode: code }));
      }
    });

    execution.signal?.addEventListener("abort", onAbort, { once: true });
    if (execution.timeout !== undefined && execution.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminate();
      }, execution.timeout * 1000);
    }
  });
}

async function prepareSandboxState(workspace: string): Promise<void> {
  await Promise.all([
    mkdir(path.join(workspace, SANDBOX_STATE_DIR, "home"), { recursive: true }),
    mkdir(path.join(workspace, SANDBOX_STATE_DIR, "tmp"), { recursive: true }),
    mkdir(path.join(workspace, SANDBOX_STATE_DIR, "xdg-config"), { recursive: true }),
    mkdir(path.join(workspace, SANDBOX_STATE_DIR, "xdg-cache"), { recursive: true }),
    mkdir(path.join(workspace, SANDBOX_STATE_DIR, "xdg-data"), { recursive: true }),
    mkdir(path.join(workspace, SANDBOX_STATE_DIR, "xdg-runtime"), { recursive: true, mode: 0o700 })
  ]);
}

function buildSandboxEnvironment(
  workspace: string,
  platform: "darwin" | "linux",
  source: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv {
  const stateDir = path.join(workspace, SANDBOX_STATE_DIR);
  const environment: NodeJS.ProcessEnv = {
    HOME: path.join(stateDir, "home"),
    TMPDIR: path.join(stateDir, "tmp"),
    TMP: path.join(stateDir, "tmp"),
    TEMP: path.join(stateDir, "tmp"),
    XDG_CONFIG_HOME: path.join(stateDir, "xdg-config"),
    XDG_CACHE_HOME: path.join(stateDir, "xdg-cache"),
    XDG_DATA_HOME: path.join(stateDir, "xdg-data"),
    XDG_RUNTIME_DIR: path.join(stateDir, "xdg-runtime"),
    PATH: platform === "darwin"
      ? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  };
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ"]) {
    const value = source?.[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function resolveSandboxRuntime(
  platform: "darwin" | "linux",
  configured: string | undefined
): Promise<string> {
  const candidates = configured
    ? [configured]
    : platform === "darwin"
      ? ["/usr/bin/sandbox-exec"]
      : ["/usr/bin/bwrap", "/bin/bwrap", ...pathsFromEnvironment("bwrap")];
  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    try {
      await access(absolute, constants.X_OK);
      return absolute;
    } catch {
      // Try the next explicit platform runtime.
    }
  }
  const runtimeName = platform === "darwin" ? "sandbox-exec" : "bwrap";
  throw securityViolation(
    `workspace-full-access requires ${runtimeName}, but no executable runtime was found.`
  );
}

function resolveRuntimeReadOnlyPaths(
  platform: "darwin" | "linux",
  configured: string[] | undefined
): string[] {
  const defaults = platform === "darwin"
    ? ["/System", "/usr", "/bin", "/sbin", "/Library", "/opt/homebrew", "/usr/local"]
    : ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/usr/local", "/opt"];
  return [...new Set([...defaults, ...(configured ?? [])].map((entry) => path.resolve(entry)))]
    .filter((entry) => existsSync(entry));
}

function pathsFromEnvironment(command: string): string[] {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.join(entry, command));
}

function translateWorkspaceEnvPath(value: string, workspace: string, sandboxWorkspace: string): string {
  if (value === workspace) return sandboxWorkspace;
  if (value.startsWith(`${workspace}${path.sep}`)) {
    return `${sandboxWorkspace}/${path.relative(workspace, value).split(path.sep).join("/")}`;
  }
  return value;
}

function quoteSandboxValue(value: string): string {
  return JSON.stringify(value);
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function securityViolation(message: string, cause?: unknown): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(ErrorCode.SECURITY_POLICY_VIOLATION, message, { cause });
}

function isSecurityViolation(error: unknown): boolean {
  return error instanceof OpenDynamicWorkflowError && error.code === ErrorCode.SECURITY_POLICY_VIOLATION;
}

function isMissingPath(error: unknown): boolean {
  if (error instanceof OpenDynamicWorkflowError && error.cause && typeof error.cause === "object") {
    return (error.cause as NodeJS.ErrnoException).code === "ENOENT";
  }
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function loadPiToolApi(): Promise<typeof import("@earendil-works/pi-coding-agent")> {
  return import("@earendil-works/pi-coding-agent");
}
