import { accessSync, constants, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

/**
 * Supported local terminal backends used by the TUI launcher.
 */
export type Backend = "tmux" | "ghostty" | "console";

/**
 * Default shell used when no explicit command is provided.
 */
export const defaultShell = process.platform === "win32" ? process.env.COMSPEC ?? "cmd" : process.env.SHELL ?? "sh";

/**
 * Runtime type guard for backend values.
 * @param value Raw string value to test.
 */
export function isBackend(value: string): value is Backend {
  return value === "tmux" || value === "ghostty" || value === "console";
}

/**
 * Resolve the best available backend, honoring an optional preference.
 * @param preferred Preferred backend set by user flags.
 * @returns A concrete backend guaranteed to have a workable launch path.
 */
export function detectTerminalBackend(preferred: Backend | null): Backend {
  if (preferred && hasBackendExecutable(preferred)) return preferred;
  if (hasBackendExecutable("tmux")) return "tmux";
  if (hasBackendExecutable("ghostty")) return "ghostty";
  return "console";
}

/**
 * Launch the shell/command using the selected backend.
 * Falls back to console mode on terminal backend launch failures.
 * @param backend Backend strategy.
 * @param command Command or shell string to execute.
 */
export function launchLocalTerminal(backend: Backend, command: string): void {
  if (backend === "tmux") {
    launchWithTmux(command);
    return;
  }
  if (backend === "ghostty" && launchWithGhostty(command)) {
    return;
  }
  launchWithConsole(command);
}

function hasBackendExecutable(backend: Backend): boolean {
  if (backend === "console") return true;
  if (backend === "tmux") return process.platform !== "win32" && hasExecutable("tmux");
  return hasExecutable("ghostty");
}

function hasExecutable(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (/[\\/]/.test(trimmed)) return isExecutablePath(trimmed);

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((entry) => entry.trim().toUpperCase())
    : [""];

  for (const entry of pathEntries) {
    const normalizedDir = path.normalize(entry.trim().replace(/^["']|["']$/g, ""));
    for (const ext of exts) {
      const candidate = path.join(normalizedDir, `${trimmed}${ext}`);
      if (isExecutablePath(candidate)) return true;
    }
  }
  return false;
}

function isExecutablePath(candidate: string): boolean {
  try {
    if (!existsSync(candidate)) return false;
    if (!statSync(candidate).isFile()) return false;
    if (process.platform === "win32") return true;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function launchWithTmux(command: string): void {
  const shell = process.platform === "win32" ? "cmd" : process.env.SHELL ?? "bash";
  try {
    spawn("tmux", ["new-window", "-n", "commandrelay", "-c", process.cwd(), `${shell} -lc ${shellQuote(command)}`], {
      stdio: "ignore",
      detached: true,
      cwd: process.cwd()
    });
  } catch {
    launchWithConsole(command);
  }
}

function launchWithGhostty(command: string): boolean {
  const shell = defaultShell;
  const attempts = [
    ["--", shell, "-lc", command],
    ["-e", shell, "-lc", command],
    ["--command", shell, "-lc", command],
    [shell, "-lc", command],
    []
  ];
  for (const args of attempts) {
    if (tryDetachedSpawn("ghostty", args)) return true;
  }
  return false;
}

function launchWithConsole(command: string): void {
  spawn(command, { stdio: "inherit", cwd: process.cwd(), shell: true });
}

function tryDetachedSpawn(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, { stdio: "ignore", cwd: process.cwd(), detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
