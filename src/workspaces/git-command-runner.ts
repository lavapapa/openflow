import { spawn } from "node:child_process";

export interface GitCommandInput {
  cwd: string;
  args: readonly string[];
  signal?: AbortSignal;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export interface GitCommandRunner {
  run(input: GitCommandInput): Promise<GitCommandResult>;
}

export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly aborted: boolean;

  constructor(input: {
    message: string;
    args: readonly string[];
    cwd: string;
    exitCode: number | null;
    stderr: string;
    stdout: string;
    aborted: boolean;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "GitCommandError";
    this.args = input.args;
    this.cwd = input.cwd;
    this.exitCode = input.exitCode;
    this.stderr = input.stderr;
    this.stdout = input.stdout;
    this.aborted = input.aborted;
  }
}

export interface ChildProcessGitCommandRunnerOptions {
  gitBinary?: string;
}

/** Runs Git directly with an argument vector. No shell is involved. */
export class ChildProcessGitCommandRunner implements GitCommandRunner {
  private readonly gitBinary: string;

  constructor(options: ChildProcessGitCommandRunnerOptions = {}) {
    this.gitBinary = options.gitBinary ?? "git";
  }

  run(input: GitCommandInput): Promise<GitCommandResult> {
    return new Promise((resolve, reject) => {
      if (input.signal?.aborted) {
        reject(new GitCommandError({
          message: "Git command was aborted before it started",
          args: input.args,
          cwd: input.cwd,
          exitCode: null,
          stderr: "",
          stdout: "",
          aborted: true
        }));
        return;
      }

      let child;
      try {
        child = spawn(this.gitBinary, [...input.args], {
          cwd: input.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        reject(new GitCommandError({
          message: "Failed to start Git command",
          args: input.args,
          cwd: input.cwd,
          exitCode: null,
          stderr: "",
          stdout: "",
          aborted: input.signal?.aborted === true,
          cause: error
        }));
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      let processError: Error | undefined;
      let aborted = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const onAbort = () => {
        aborted = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
        forceKillTimer.unref();
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) {
        onAbort();
      }

      const cleanup = () => {
        input.signal?.removeEventListener("abort", onAbort);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        processError = error;
      });

      child.on("close", (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();

        if (processError) {
          reject(new GitCommandError({
            message: aborted ? "Git command was aborted" : "Git command failed to start",
            args: input.args,
            cwd: input.cwd,
            exitCode,
            stderr,
            stdout,
            aborted,
            cause: processError
          }));
          return;
        }

        if (exitCode === 0) {
          resolve({ stdout, stderr });
          return;
        }

        reject(new GitCommandError({
          message: aborted
            ? "Git command was aborted"
            : `Git command exited with code ${String(exitCode)}`,
          args: input.args,
          cwd: input.cwd,
          exitCode,
          stderr,
          stdout,
          aborted
        }));
      });
    });
  }
}
