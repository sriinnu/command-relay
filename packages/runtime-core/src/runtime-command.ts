/**
 * @file Runtime command execution helpers shared by backend packages.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_CONCURRENT_COMMANDS = 12;
const MIN_CONCURRENT_COMMANDS = 1;
const MAX_CONCURRENT_COMMANDS = 64;
const MAX_RUNTIME_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_RUNTIME_COMMAND_QUEUE_SIZE = 256;
const MIN_RUNTIME_COMMAND_QUEUE_SIZE = 1;
const MAX_RUNTIME_COMMAND_QUEUE_SIZE = 4_096;

function normalizePositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

interface QueuedRuntimeCommand {
  execute: () => Promise<void>;
}

const commandQueue: QueuedRuntimeCommand[] = [];
let activeCommandCount = 0;

function getRuntimeCommandLimits(): {
  maxConcurrentRuntimeCommands: number;
  maxRuntimeCommandQueueSize: number;
} {
  return {
    maxConcurrentRuntimeCommands: normalizePositiveInt(
      process.env.COMMANDRELAY_RUNTIME_MAX_CONCURRENT_COMMANDS,
      DEFAULT_MAX_CONCURRENT_COMMANDS,
      MIN_CONCURRENT_COMMANDS,
      MAX_CONCURRENT_COMMANDS
    ),
    maxRuntimeCommandQueueSize: normalizePositiveInt(
      process.env.COMMANDRELAY_RUNTIME_MAX_QUEUED_COMMANDS
        ?? process.env.COMMANDRELAY_RUNTIME_MAX_COMMAND_QUEUE,
      DEFAULT_MAX_RUNTIME_COMMAND_QUEUE_SIZE,
      MIN_RUNTIME_COMMAND_QUEUE_SIZE,
      MAX_RUNTIME_COMMAND_QUEUE_SIZE
    )
  };
}

function withRuntimeCommandConcurrencyLimit<T>(runCommand: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const { maxRuntimeCommandQueueSize } = getRuntimeCommandLimits();
    if (commandQueue.length >= maxRuntimeCommandQueueSize) {
      reject(
        new Error(`runtime command queue full (max ${maxRuntimeCommandQueueSize} pending commands)`)
      );
      return;
    }

    commandQueue.push({
      execute: async () => {
        try {
          resolve(await runCommand());
        } catch (error) {
          reject(error);
        }
      }
    });
    drainRuntimeCommandQueue();
  });
}

function drainRuntimeCommandQueue(): void {
  const { maxConcurrentRuntimeCommands } = getRuntimeCommandLimits();
  while (activeCommandCount < maxConcurrentRuntimeCommands) {
    const queued = commandQueue.shift();
    if (!queued) {
      return;
    }

    activeCommandCount += 1;
    void queued.execute().finally(() => {
      activeCommandCount -= 1;
      drainRuntimeCommandQueue();
    });
  }
}

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
  return withRuntimeCommandConcurrencyLimit(async () => {
    const { stdout } = await execFileAsync(command, args, {
      timeout: normalizedOptions.timeoutMs ?? 5_000,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: normalizedOptions.env
    });
    return stdout;
  });
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
  return withRuntimeCommandConcurrencyLimit(async () => {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: normalizedOptions.env
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let bufferedBytes = 0;
      let done = false;
      let limitExceeded = false;

      const finish = (callback: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        callback();
      };

      const rejectForOutputLimit = (): void => {
        if (limitExceeded) return;
        limitExceeded = true;
        child.kill();
        finish(() =>
          reject(
            new Error(
              `Command output exceeded ${MAX_RUNTIME_COMMAND_OUTPUT_BYTES} bytes: ${command}`
            )
          )
        );
      };

      const appendChunk = (chunks: string[], chunk: string): void => {
        if (limitExceeded) return;
        const chunkBytes = Buffer.byteLength(chunk, "utf8");
        if (bufferedBytes + chunkBytes > MAX_RUNTIME_COMMAND_OUTPUT_BYTES) {
          rejectForOutputLimit();
          return;
        }
        bufferedBytes += chunkBytes;
        chunks.push(chunk);
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`)));
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        appendChunk(stdoutChunks, chunk);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        appendChunk(stderrChunks, chunk);
      });

      child.on("error", (error) => {
        finish(() => reject(error));
      });
      child.on("close", (code, signal) => {
        finish(() => {
          if (code === 0) {
            resolve(stdoutChunks.join(""));
            return;
          }

          const signalSuffix = signal ? ` signal=${signal}` : "";
          const stderr = stderrChunks.join("");
          const stderrSuffix = stderr.trim() ? ` stderr=${stderr.trim()}` : "";
          reject(new Error(`Command failed (${code})${signalSuffix}: ${command}${stderrSuffix}`));
        });
      });

      child.stdin.on("error", () => {
        // Ignore stdin closure races on exit.
      });
      child.stdin.end(input);
    });

    return result;
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
