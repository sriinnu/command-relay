/**
 * @file Runtime command execution helpers shared by backend packages.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Command execution options for runtime backends.
 */
export interface RuntimeCommandOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

type RuntimeCommandOptionsArg = RuntimeCommandOptions | number | undefined;

/**
 * Signature for command runner injection.
 */
export type RuntimeCommandRunner = (
  command: string,
  args: string[],
  options?: RuntimeCommandOptionsArg
) => Promise<string>;

/**
 * Signature for command runner injection with UTF-8 stdin piping.
 */
export type RuntimeCommandRunnerWithInput = (
  command: string,
  args: string[],
  input: string,
  options?: RuntimeCommandOptionsArg
) => Promise<string>;

/**
 * Executes a command and returns UTF-8 stdout.
 *
 * @param command Executable to invoke.
 * @param args Command arguments.
 * @param options Timeout and environment overrides.
 * @returns Process standard output.
 */
export async function execRuntimeCommand(
  command: string,
  args: string[],
  options: RuntimeCommandOptionsArg = {}
): Promise<string> {
  const normalizedOptions = normalizeRuntimeCommandOptions(options);
  const { stdout } = await execFileAsync(command, args, {
    timeout: normalizedOptions.timeoutMs ?? 5_000,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env: normalizedOptions.env
  });
  return stdout;
}

/**
 * Executes a command with UTF-8 stdin input and returns stdout.
 *
 * @param command Executable to invoke.
 * @param args Command arguments.
 * @param input UTF-8 input payload.
 * @param options Timeout and environment overrides.
 * @returns Process standard output.
 */
export async function execRuntimeCommandWithInput(
  command: string,
  args: string[],
  input: string,
  options: RuntimeCommandOptionsArg = {}
): Promise<string> {
  const normalizedOptions = normalizeRuntimeCommandOptions(options);
  const timeoutMs = normalizedOptions.timeoutMs ?? 5_000;
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: normalizedOptions.env
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (callback: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`)));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        const signalSuffix = signal ? ` signal=${signal}` : "";
        const stderrSuffix = stderr.trim() ? ` stderr=${stderr.trim()}` : "";
        reject(new Error(`Command failed (${code})${signalSuffix}: ${command}${stderrSuffix}`));
      });
    });

    child.stdin.on("error", () => {
      // Ignore stdin closure races on exit.
    });
    child.stdin.end(input);
  });
}

/**
 * Normalizes capture line counts to a positive integer.
 *
 * @param lines Requested line count.
 * @returns Safe line count.
 */
export function normalizeRuntimeLineCount(lines: number): number {
  const normalized = Math.trunc(Math.abs(Number(lines)));
  return Math.max(1, normalized);
}

function normalizeRuntimeCommandOptions(options: RuntimeCommandOptionsArg): RuntimeCommandOptions {
  if (typeof options === "number") {
    return { timeoutMs: options };
  }

  return options ?? {};
}
