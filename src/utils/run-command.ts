/**
 * @file Child process helper for safe command execution.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Executes a command and returns UTF-8 output.
 *
 * @param {string} command Executable to invoke.
 * @param {string[]} args Command arguments.
 * @param {number} [timeoutMs=5000] Command timeout in milliseconds.
 * @returns {Promise<string>} Trimmed standard output.
 */
export async function runCommand(command, args, timeoutMs = 5000) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: timeoutMs,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  return stdout;
}
