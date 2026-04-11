/**
 * @file Terminal, shell, and host discovery heuristics for cross-platform CommandRelay runtimes.
 */

import process from "node:process";

/**
 * Supported host platform groups.
 */
export type HostPlatform = "linux" | "macos" | "windows";

/**
 * Supported discovered terminal kinds.
 */
export type TerminalKind =
  | "tmux"
  | "cmux"
  | "ghostty"
  | "terminal.app"
  | "iterm"
  | "windows-terminal"
  | "cmd"
  | "powershell"
  | "putty"
  | "ssh"
  | "wsl"
  | "console";

/**
 * Broad shell family classification.
 */
export type ShellFamily = "posix" | "cmd" | "powershell";

/**
 * Discovery options for testing and embedding.
 */
export interface TerminalDiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  hasExecutable?: (name: string) => boolean;
}

/**
 * Snapshot of discovered terminal and runtime host traits.
 */
export interface TerminalDiscoverySnapshot {
  platform: HostPlatform;
  terminalKind: TerminalKind;
  shellFamily: ShellFamily;
  isSshSession: boolean;
  isWsl: boolean;
  availableTerminals: TerminalKind[];
  preferredRuntimeBackends: string[];
}

/**
 * Detects terminal, shell, and runtime host traits for the current process.
 *
 * @param options Optional discovery overrides.
 * @returns Normalized discovery snapshot.
 */
export function detectTerminalEnvironment(
  options: TerminalDiscoveryOptions = {}
): TerminalDiscoverySnapshot {
  const env = options.env ?? process.env;
  const platform = normalizePlatform(options.platform ?? process.platform);
  const isSshSession = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  const availableTerminals = detectAvailableTerminals({ platform, env, hasExecutable: options.hasExecutable });
  const terminalKind = detectTerminalKind(platform, env, isSshSession, isWsl, availableTerminals);
  const shellFamily = detectShellFamily(platform, env);

  return {
    platform,
    terminalKind,
    shellFamily,
    isSshSession,
    isWsl,
    availableTerminals,
    preferredRuntimeBackends: detectPreferredRuntimeBackends(platform, availableTerminals, isSshSession)
  };
}

/**
 * Detects all candidate terminals and multiplexers available on the current host.
 *
 * @param options Optional discovery overrides.
 * @returns Ordered list of discovered terminal kinds.
 */
export function detectAvailableTerminals(
  options: Omit<TerminalDiscoveryOptions, "platform"> & { platform?: HostPlatform } = {}
): TerminalKind[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? normalizePlatform(process.platform);
  const hasExecutable = options.hasExecutable ?? (() => false);
  const terminals: TerminalKind[] = [];

  if (hasExecutable("tmux")) terminals.push("tmux");
  if (hasExecutable("cmux")) terminals.push("cmux");
  if (hasExecutable("ghostty")) terminals.push("ghostty");
  if (platform === "macos") terminals.push("terminal.app");
  if (platform === "windows") {
    if (env.WT_SESSION || hasExecutable("wt")) terminals.push("windows-terminal");
    terminals.push("cmd");
    terminals.push("powershell");
    if (hasExecutable("putty") || hasExecutable("plink")) terminals.push("putty");
  }
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) terminals.push("ssh");
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) terminals.push("wsl");
  terminals.push("console");

  return [...new Set(terminals)];
}

function detectTerminalKind(
  platform: HostPlatform,
  env: NodeJS.ProcessEnv,
  isSshSession: boolean,
  isWsl: boolean,
  availableTerminals: TerminalKind[]
): TerminalKind {
  const termProgram = String(env.TERM_PROGRAM ?? "").trim();
  if (termProgram === "Apple_Terminal") return "terminal.app";
  if (termProgram === "iTerm.app") return "iterm";
  if (termProgram === "Ghostty" || env.GHOSTTY_RESOURCES_DIR) return "ghostty";
  if (env.WT_SESSION) return "windows-terminal";
  if (isSshSession) return "ssh";
  if (isWsl) return "wsl";
  if (platform === "windows" && isPowerShellEnv(env)) return "powershell";
  if (platform === "windows") return "cmd";
  return availableTerminals[0] ?? "console";
}

function detectShellFamily(platform: HostPlatform, env: NodeJS.ProcessEnv): ShellFamily {
  if (platform === "windows" && isPowerShellEnv(env)) return "powershell";
  if (platform === "windows") return "cmd";
  return "posix";
}

function detectPreferredRuntimeBackends(
  platform: HostPlatform,
  availableTerminals: TerminalKind[],
  isSshSession: boolean
): string[] {
  const preferred: string[] = [];
  if (availableTerminals.includes("tmux")) preferred.push("tmux");
  if (availableTerminals.includes("cmux")) preferred.push("cmux");
  if (platform === "windows" || isSshSession || preferred.length === 0) preferred.push("managed");
  return [...new Set(preferred)];
}

function normalizePlatform(platform: NodeJS.Platform): HostPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

function isPowerShellEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.PSModulePath || env.POWERSHELL_DISTRIBUTION_CHANNEL || env.PSExecutionPolicyPreference);
}
