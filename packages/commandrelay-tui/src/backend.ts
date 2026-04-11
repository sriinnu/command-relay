import { accessSync, constants, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { detectTerminalEnvironment } from "@commandrelay/terminal-discovery";

/**
 * Supported local terminal backends used by the TUI launcher.
 */
export type Backend =
  | "tmux"
  | "ghostty"
  | "terminal.app"
  | "windows-terminal"
  | "cmd"
  | "powershell"
  | "wsl"
  | "console";

/**
 * Optional overrides used to test terminal backend detection deterministically.
 */
export interface BackendDetectionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  hasExecutable?: (name: string) => boolean;
}

/**
 * Optional overrides used to test duplicate detached-launch suppression.
 */
export interface LaunchSuppressionOptions {
  nowMs?: number;
  recentLaunches?: Map<string, number>;
  suppressionWindowMs?: number;
}

/**
 * Default shell used when no explicit command is provided.
 */
export const defaultShell = process.platform === "win32" ? process.env.COMSPEC ?? "cmd" : process.env.SHELL ?? "sh";
const REPEATED_DETACHED_LAUNCH_WINDOW_MS = 1_500;
const recentDetachedLaunches = new Map<string, number>();

/**
 * Runtime type guard for backend values.
 * @param value Raw string value to test.
 */
export function isBackend(value: string): value is Backend {
  return [
    "tmux",
    "ghostty",
    "terminal.app",
    "windows-terminal",
    "cmd",
    "powershell",
    "wsl",
    "console"
  ].includes(value);
}

/**
 * Returns true when the supplied backend can be launched on the current host.
 *
 * @param backend Backend candidate.
 * @param options Optional platform and executable overrides for tests.
 * @returns True when the backend is launchable.
 */
export function canLaunchBackend(backend: Backend, options: BackendDetectionOptions = {}): boolean {
  const platform = options.platform ?? process.platform;
  const executableCheck = options.hasExecutable ?? hasExecutable;
  return isLaunchableBackend(backend, platform, executableCheck);
}

/**
 * Resolve the best available backend, honoring an optional preference.
 * @param preferred Preferred backend set by user flags.
 * @returns A concrete backend guaranteed to have a workable launch path.
 */
export function detectTerminalBackend(
  preferred: Backend | null,
  options: BackendDetectionOptions = {}
): Backend {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const executableCheck = options.hasExecutable ?? hasExecutable;
  const snapshot = detectTerminalEnvironment({
    platform,
    env,
    hasExecutable: executableCheck
  });

  if (preferred && isLaunchableBackend(preferred, platform, executableCheck)) {
    return preferred;
  }

  const detectedBackend = mapTerminalKindToBackend(snapshot.terminalKind, platform);
  if (detectedBackend && isLaunchableBackend(detectedBackend, platform, executableCheck)) {
    return detectedBackend;
  }

  for (const candidate of getFallbackBackends(platform)) {
    if (isLaunchableBackend(candidate, platform, executableCheck)) {
      return candidate;
    }
  }

  return "console";
}

/**
 * Launch the shell/command using the selected backend.
 * Falls back to console mode on terminal backend launch failures.
 * @param backend Backend strategy.
 * @param command Command or shell string to execute.
 */
export function launchLocalTerminal(backend: Backend, command: string): void {
  if (shouldSuppressDetachedLaunch(backend, command)) {
    return;
  }
  if (backend === "tmux") {
    launchWithTmux(command);
    return;
  }
  if (backend === "ghostty" && launchWithGhostty(command)) {
    return;
  }
  if (backend === "terminal.app" && launchWithTerminalApp(command)) {
    return;
  }
  if (backend === "windows-terminal" && launchWithWindowsTerminal(command)) {
    return;
  }
  if (backend === "powershell" && launchWithPowerShell(command)) {
    return;
  }
  if (backend === "cmd" && launchWithCmd(command)) {
    return;
  }
  if (backend === "wsl" && launchWithWsl(command)) {
    return;
  }
  launchWithConsole(command);
}

/**
 * Suppresses identical detached launcher requests inside a short debounce window.
 *
 * @param backend Terminal backend selected by the caller.
 * @param command Command text that will be launched.
 * @param options Optional deterministic hooks for tests.
 * @returns True when the launch should be skipped as a rapid duplicate.
 */
export function shouldSuppressDetachedLaunch(
  backend: Backend,
  command: string,
  options: LaunchSuppressionOptions = {}
): boolean {
  if (backend === "console") {
    return false;
  }

  const normalizedCommand = command.trim() || defaultShell;
  const nowMs = options.nowMs ?? Date.now();
  const recentLaunches = options.recentLaunches ?? recentDetachedLaunches;
  const suppressionWindowMs = options.suppressionWindowMs ?? REPEATED_DETACHED_LAUNCH_WINDOW_MS;
  pruneRecentLaunches(recentLaunches, nowMs, suppressionWindowMs);

  const key = `${backend}\u0000${normalizedCommand}`;
  const previousLaunchAtMs = recentLaunches.get(key);
  recentLaunches.set(key, nowMs);
  return typeof previousLaunchAtMs === "number" && nowMs - previousLaunchAtMs < suppressionWindowMs;
}

function hasBackendExecutable(backend: Backend): boolean {
  if (backend === "console") return true;
  if (backend === "tmux") return process.platform !== "win32" && hasExecutable("tmux");
  if (backend === "ghostty") return hasExecutable("ghostty");
  if (backend === "terminal.app") return process.platform === "darwin" && hasExecutable("osascript");
  if (backend === "windows-terminal") return process.platform === "win32" && hasAnyExecutable(["wt", "wt.exe"]);
  if (backend === "powershell") {
    return process.platform === "win32" && hasAnyExecutable(["pwsh.exe", "pwsh", "powershell.exe", "powershell"]);
  }
  if (backend === "cmd") return process.platform === "win32" && hasAnyExecutable(["cmd.exe", "cmd"]);
  if (backend === "wsl") return process.platform === "win32" && hasAnyExecutable(["wsl.exe", "wsl"]);
  return false;
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

function hasAnyExecutable(names: string[]): boolean {
  return names.some((name) => hasExecutable(name));
}

function isLaunchableBackend(
  backend: Backend,
  platform: NodeJS.Platform,
  executableCheck: (name: string) => boolean
): boolean {
  if (backend === "console") return true;
  if (backend === "tmux") return platform !== "win32" && executableCheck("tmux");
  if (backend === "ghostty") return executableCheck("ghostty");
  if (backend === "terminal.app") return platform === "darwin" && executableCheck("osascript");
  if (backend === "windows-terminal") return platform === "win32" && (executableCheck("wt") || executableCheck("wt.exe"));
  if (backend === "powershell") {
    return platform === "win32" && ["pwsh.exe", "pwsh", "powershell.exe", "powershell"].some(executableCheck);
  }
  if (backend === "cmd") return platform === "win32" && (executableCheck("cmd.exe") || executableCheck("cmd"));
  if (backend === "wsl") return platform === "win32" && (executableCheck("wsl.exe") || executableCheck("wsl"));
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
  if (!tryDetachedSpawn("tmux", [
    "new-window",
    "-n",
    "commandrelay",
    "-c",
    process.cwd(),
    `${shell} -lc ${shellQuote(command)}`
  ])) {
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

function launchWithTerminalApp(command: string): boolean {
  if (process.platform !== "darwin") return false;

  const inlineCommand = `cd ${shellQuote(process.cwd())}; ${command}`;
  const script = [
    'tell application "Terminal"',
    "activate",
    `do script "${escapeAppleScriptString(inlineCommand)}"`,
    "end tell"
  ].join("\n");

  return tryDetachedSpawn("osascript", ["-e", script]);
}

function launchWithWindowsTerminal(command: string): boolean {
  if (process.platform !== "win32") return false;

  const shellSpec = resolveWindowsShellSpec(command);
  const attempts = [
    ["new-tab", "--startingDirectory", process.cwd(), shellSpec.command, ...shellSpec.args],
    ["-w", "0", "new-tab", "--startingDirectory", process.cwd(), shellSpec.command, ...shellSpec.args]
  ];

  for (const executable of ["wt.exe", "wt"]) {
    for (const args of attempts) {
      if (tryDetachedSpawn(executable, args)) return true;
    }
  }

  return false;
}

function launchWithPowerShell(command: string): boolean {
  if (process.platform !== "win32") return false;
  const shell = resolveWindowsPowerShellCommand();
  if (!shell) return false;

  return tryDetachedSpawn("cmd.exe", ["/c", "start", "", shell, "-NoExit", "-Command", command]);
}

function launchWithCmd(command: string): boolean {
  if (process.platform !== "win32") return false;
  return tryDetachedSpawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", command]);
}

function launchWithWsl(command: string): boolean {
  if (process.platform !== "win32") return false;
  const wslCommand = hasExecutable("wsl.exe") ? "wsl.exe" : hasExecutable("wsl") ? "wsl" : null;
  if (!wslCommand) return false;

  return tryDetachedSpawn("cmd.exe", ["/c", "start", "", wslCommand, "sh", "-lc", command]);
}

function launchWithConsole(command: string): void {
  spawn(command, { stdio: "inherit", cwd: process.cwd(), shell: true });
}

function mapTerminalKindToBackend(
  terminalKind: ReturnType<typeof detectTerminalEnvironment>["terminalKind"],
  platform: NodeJS.Platform
): Backend | null {
  if (terminalKind === "tmux") return "tmux";
  if (terminalKind === "ghostty") return "ghostty";
  if (terminalKind === "terminal.app") return "terminal.app";
  if (terminalKind === "windows-terminal") return "windows-terminal";
  if (terminalKind === "powershell") return "powershell";
  if (terminalKind === "cmd") return "cmd";
  if (terminalKind === "wsl" && platform === "win32") return "wsl";
  return null;
}

function getFallbackBackends(platform: NodeJS.Platform): Backend[] {
  if (platform === "darwin") {
    return ["tmux", "ghostty", "terminal.app", "console"];
  }
  if (platform === "win32") {
    return ["windows-terminal", "powershell", "cmd", "wsl", "console"];
  }
  return ["tmux", "ghostty", "console"];
}

function tryDetachedSpawn(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, {
      stdio: "ignore",
      cwd: process.cwd(),
      detached: true,
      windowsHide: false
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function pruneRecentLaunches(
  recentLaunches: Map<string, number>,
  nowMs: number,
  suppressionWindowMs: number
): void {
  const staleAfterMs = suppressionWindowMs * 4;
  for (const [key, launchedAtMs] of recentLaunches.entries()) {
    if (nowMs - launchedAtMs >= staleAfterMs) {
      recentLaunches.delete(key);
    }
  }
}

function shellQuote(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveWindowsPowerShellCommand(): string | null {
  for (const candidate of ["pwsh.exe", "pwsh", "powershell.exe", "powershell"]) {
    if (hasExecutable(candidate)) return candidate;
  }
  return null;
}

function resolveWindowsShellSpec(command: string): { command: string; args: string[] } {
  const powerShell = resolveWindowsPowerShellCommand();
  if (powerShell) {
    return {
      command: powerShell,
      args: ["-NoExit", "-Command", command]
    };
  }

  return {
    command: process.env.COMSPEC ?? "cmd.exe",
    args: ["/k", command]
  };
}
