import {
  isValidProfileName,
  isValidProfileUrl,
  loadProfiles,
  removeProfile,
  resolveProfileSelection,
  setActiveProfile,
  setProfileToken,
  touchProfile,
  upsertProfile
} from "./connection-profile.js";
import { isAuthenticationError } from "@commandrelay/client";
import { isBackend, defaultShell, launchLocalTerminal } from "./backend.js";
import { promptToken } from "./token.js";
import type { CliState } from "./cli-state.js";

interface CliCommandContext {
  state: CliState;
  writeLine: (text: string) => void;
  connectAndBootstrap: () => Promise<void>;
  requestReconnect: () => Promise<void>;
  requestDisconnect: () => Promise<void>;
  requestExit: () => void;
  refreshSessions: (silent: boolean) => Promise<void>;
  reconnectMetricsLine: () => string;
}

export interface CliCommandHandlers {
  runCommand(raw: string): Promise<void>;
  runInputCommand(raw: string): Promise<void>;
}

/**
 * Build interactive command and input handlers for the command line loop.
 */
export function createCliCommandHandlers(context: CliCommandContext): CliCommandHandlers {
  const runCommand = async (raw: string): Promise<void> => {
    if (raw.startsWith("/help")) return writeHelp(context);
    if (raw.startsWith("/list")) return context.refreshSessions(false);
    if (raw === "/attach") return context.writeLine("usage: /attach <pane-id>");
    if (raw.startsWith("/attach ")) {
      const pane = raw.slice(8).trim();
      if (!pane) return context.writeLine("usage: /attach <pane-id>");
      return attachPane(context, pane);
    }
    if (raw === "/detach") return detachCurrentPane(context);
    if (raw === "/profiles") return listProfilesCommand(context);
    if (raw.startsWith("/profile")) return runProfile(context, raw);
    if (raw === "/enable") return enableInput(context);
    if (raw === "/disable") return disableInput(context);
    if (raw === "/token") return runAuth(context);
    if (raw.startsWith("/token ")) return context.writeLine("usage: /token");
    if (raw.startsWith("/reconnect")) return context.requestReconnect();
    if (raw.startsWith("/health")) return runHealth(context);
    if (raw === "/backend") return context.writeLine(`local backend preference: ${context.state.backend}`);
    if (raw === "/open" || raw.startsWith("/open ")) {
      return launchLocalTerminal(context.state.backend, raw.slice(5).trim() || defaultShell);
    }
    if (raw.startsWith("/status")) return writeStatus(context);
    if (raw === "/quit" || raw === "/exit") {
      await context.requestDisconnect();
      context.requestExit();
      return;
    }
    context.writeLine("unknown command; /help for options");
  };

  const runInputCommand = async (raw: string): Promise<void> => {
    if (!context.state.client || !context.state.activePane) {
      context.writeLine("attach a pane first: /attach <pane-id>");
      return;
    }
    if (!context.state.hello || !context.state.hello.inputEnabled || context.state.hello.globalInputDisabled) {
      context.writeLine("input disabled; run /enable first");
      return;
    }
    const payload = `${raw}\n`;
    if (typeof context.state.hello?.maxInputBytes === "number") {
      if (context.state.hello.maxInputBytes <= 0) {
        context.writeLine("input disabled by remote limit");
        return;
      }
      if (Buffer.byteLength(payload, "utf8") > context.state.hello.maxInputBytes) {
        context.writeLine("input too large");
        return;
      }
    }

    try {
      await context.state.client.sendInput(context.state.activePane, payload, false);
    } catch (error) {
      context.writeLine(`send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return { runCommand, runInputCommand };
}

async function runAuth(context: CliCommandContext): Promise<void> {
  const candidate = await promptToken();
  if (!candidate) {
    context.writeLine("auth token cancelled");
    return;
  }

  try {
    if (!context.state.client) {
      context.state.authToken = candidate;
      context.state.authFailureBlocked = false;
      await context.connectAndBootstrap();
      if (context.state.activeProfile.activeProfileName) {
        setProfileToken(context.state.activeProfile.activeProfileName, candidate);
      }
      context.writeLine("authenticated");
      return;
    }

    await context.state.client.authenticate(candidate);
    context.state.authToken = candidate;
    if (context.state.activeProfile.activeProfileName) {
      setProfileToken(context.state.activeProfile.activeProfileName, candidate);
    }
    context.writeLine("authenticated");
  } catch (error) {
    context.writeLine(`auth failed: ${error instanceof Error ? error.message : String(error)}`);
    if (isAuthenticationError(error)) {
      context.state.authFailureBlocked = true;
    }
    context.state.authToken = null;
  }
}

async function listProfilesCommand(context: CliCommandContext): Promise<void> {
  const store = loadProfiles();
  const names = Object.keys(store.profiles).sort();
  if (names.length === 0) {
    context.writeLine("no profiles saved");
    context.writeLine("add profile: /profile add <name> <ws-url> [backend]");
    return;
  }

  context.writeLine("saved profiles:");
  for (const name of names) {
    const profile = store.profiles[name];
    const marker = context.state.activeProfile.activeProfileName === name ? " * " : "   ";
    const backend = profile.backend ? ` backend=${profile.backend}` : "";
    const lastUsed = profile.lastUsedAt ? new Date(profile.lastUsedAt).toISOString() : "never";
    context.writeLine(`${marker}${name}  ${profile.url}  ${backend}  lastUsed=${lastUsed}`);
  }
  context.writeLine(`active: ${context.state.activeProfile.activeProfileName ?? "none"}`);
}

async function runProfile(context: CliCommandContext, raw: string): Promise<void> {
  const parts = raw.trim().split(/\s+/);
  const action = (parts[1] ?? "").toLowerCase();

  if (!action || action === "help") {
    context.writeLine("usage:");
    context.writeLine("  /profiles                       list profiles");
    context.writeLine("  /profile add <name> <ws-url> [tmux|ghostty|console]");
    context.writeLine("  /profile use <name>");
    context.writeLine("  /profile rm <name>");
    context.writeLine("  /profile token [name]");
    return;
  }

  if (action === "add") {
    const name = parts[2];
    const profileUrl = parts[3];
    const rawBackend = parts[4];
    if (!name || !profileUrl) {
      context.writeLine("usage: /profile add <name> <ws-url> [tmux|ghostty|console]");
      return;
    }
    if (!isValidProfileName(name)) {
      context.writeLine("invalid profile name");
      return;
    }
    if (!isValidProfileUrl(profileUrl)) {
      context.writeLine("profile URL must be ws:// or wss://");
      return;
    }
    if (rawBackend && !isBackend(rawBackend)) {
      context.writeLine("invalid backend");
      return;
    }

    upsertProfile({
      name,
      url: profileUrl,
      backend: rawBackend && isBackend(rawBackend) ? rawBackend : undefined
    });

    const selected = resolveProfileSelection(name);
    context.state.activeProfile = selected;
    context.state.url = selected.selectedProfile?.url ?? context.state.url;
    if (selected.selectedProfile?.backend) {
      context.state.backend = selected.selectedProfile.backend;
    }
    context.writeLine(`saved profile ${name}`);
    if (!context.state.connected && !context.state.client) {
      context.writeLine(`active profile set to ${name}`);
    }
    return;
  }

  if (action === "rm" || action === "remove") {
    const name = parts[2];
    if (!name) {
      context.writeLine("usage: /profile rm <name>");
      return;
    }
    removeProfile(name);
    if (context.state.activeProfile.activeProfileName === name) {
      context.state.activeProfile = resolveProfileSelection(null);
    }
    context.writeLine(`removed profile ${name}`);
    return;
  }

  if (action === "use") {
    const name = parts[2];
    if (!name) {
      context.writeLine("usage: /profile use <name>");
      return;
    }
    const selected = resolveProfileSelection(name);
    if (!selected.selectedProfile) {
      context.writeLine(`profile not found: ${name}`);
      return;
    }

    context.state.url = selected.selectedProfile.url;
    if (selected.selectedProfile.backend) {
      context.state.backend = selected.selectedProfile.backend;
    }
    context.state.activeProfile = selected;
    context.state.authToken = selected.selectedProfile.authToken ?? null;
    setActiveProfile(name);
    touchProfile(name);
    context.writeLine(`switched profile ${name}`);

    if (context.state.client) {
      await context.requestDisconnect();
      context.state.userRequestedClose = false;
      await context.requestReconnect();
      return;
    }

    await context.requestReconnect();
    return;
  }

  if (action === "token") {
    const requestedName = parts[2] ?? context.state.activeProfile.activeProfileName ?? null;
    if (!requestedName) {
      context.writeLine("usage: /profile token [name]");
      return;
    }

    const store = loadProfiles();
    if (!store.profiles[requestedName]) {
      context.writeLine(`profile not found: ${requestedName}`);
      return;
    }

    const token = await promptToken();
    if (!token) return context.writeLine("token cancelled");

    setProfileToken(requestedName, token);
    if (context.state.activeProfile.activeProfileName === requestedName) {
      context.state.authToken = token;
    }
    context.writeLine(`token saved for profile ${requestedName}`);
    return;
  }

  context.writeLine("unknown /profile action; /profile help");
}

async function runHealth(context: CliCommandContext): Promise<void> {
  try {
    const healthUrl = buildHealthUrl(context.state.url);
    const response = await fetch(healthUrl, { headers: { accept: "application/json" } });
    if (!response.ok) {
      context.writeLine(`health request failed: ${response.status} ${response.statusText}`);
      return;
    }
    const healthPayload = await response.json() as Record<string, unknown>;
    const status = typeof healthPayload.status === "string" ? healthPayload.status : "unknown";
    const clients = typeof healthPayload.clients === "number" ? healthPayload.clients : 0;
    const panes = typeof healthPayload.panesAttached === "number" ? healthPayload.panesAttached : 0;
    const uptime = typeof healthPayload.uptimeMs === "number" ? healthPayload.uptimeMs : 0;
    const transportMode = typeof healthPayload.transportMode === "string" ? healthPayload.transportMode : "unknown";
    context.writeLine(`health: status=${status} transport=${transportMode} clients=${clients} panes=${panes} uptime=${formatDurationMs(uptime)}`);
  } catch (error) {
    context.writeLine(`health failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildHealthUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0ms";
  const totalSeconds = Math.floor(value / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d${hours}h${minutes}m${seconds}s`;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

async function attachPane(context: CliCommandContext, paneId: string): Promise<void> {
  if (!context.state.client) return context.writeLine("not connected");
  if (!paneId) return context.writeLine("usage: /attach <pane-id>");
  try {
    const lastSeq = context.state.lastSeqByPane.get(paneId);
    await context.state.client.attach(paneId, lastSeq);
    context.state.activePane = paneId;
    context.writeLine(`attached ${paneId}`);
  } catch (error) {
    context.writeLine(`attach failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function detachCurrentPane(context: CliCommandContext): Promise<void> {
  if (!context.state.client || !context.state.activePane) return context.writeLine("no attached pane");
  try {
    await context.state.client.detach(context.state.activePane);
    context.writeLine(`detached ${context.state.activePane}`);
    context.state.activePane = null;
  } catch (error) {
    context.writeLine(`detach failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function enableInput(context: CliCommandContext): Promise<void> {
  if (!context.state.client) return context.writeLine("not connected");
  try {
    const response = await context.state.client.enableInput();
    if (context.state.hello) context.state.hello.inputEnabled = Boolean(response.inputEnabled);
    if (context.state.hello) context.state.hello.globalInputDisabled = Boolean(response.globalInputDisabled);
    context.writeLine("input enabled");
  } catch (error) {
    context.writeLine(`enable failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function disableInput(context: CliCommandContext): Promise<void> {
  if (!context.state.client) return context.writeLine("not connected");
  try {
    const response = await context.state.client.disableInput();
    if (context.state.hello) context.state.hello.inputEnabled = Boolean(response.inputEnabled);
    if (context.state.hello) context.state.hello.globalInputDisabled = Boolean(response.globalInputDisabled);
    context.writeLine("input disabled");
  } catch (error) {
    context.writeLine(`disable failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeStatus(context: CliCommandContext): void {
  if (!context.state.connected) {
    const now = Date.now();
    const cooldownMs = Math.max(context.state.reconnectCooldownUntil - now, 0);
    const nextReconnect = context.state.authFailureBlocked
      ? "manual-auth"
      : context.state.reconnectCooldownUntil > now
        ? `after ${Math.ceil(cooldownMs / 1000)}s`
        : "immediate";
    context.writeLine("status: disconnected");
    context.writeLine(`profile: ${context.state.activeProfile.activeProfileName ?? "none"}`);
    context.writeLine(`manual auth required: ${context.state.authFailureBlocked ? "yes" : "no"}`);
    context.writeLine(`next reconnect: ${nextReconnect}`);
    context.writeLine(context.reconnectMetricsLine());
    return;
  }

  const now = Date.now();
  const cooldownMs = Math.max(context.state.reconnectCooldownUntil - now, 0);
  const nextReconnect = context.state.authFailureBlocked
    ? "manual-auth"
    : context.state.reconnectCooldownUntil > now
      ? `after ${Math.ceil(cooldownMs / 1000)}s`
      : "immediate";
  context.writeLine("status: connected");
  context.writeLine(`profile: ${context.state.activeProfile.activeProfileName ?? "none"}`);
  context.writeLine(`url: ${context.state.url}`);
  context.writeLine(`backend: ${context.state.backend}`);
  context.writeLine(`active pane: ${context.state.activePane ?? "(none)"}`);
  context.writeLine(`input enabled: ${context.state.hello?.inputEnabled ? "on" : "off"}`);
  context.writeLine(`global input disabled: ${context.state.hello?.globalInputDisabled ? "on" : "off"}`);
  context.writeLine(`manual auth required: ${context.state.authFailureBlocked ? "yes" : "no"}`);
  context.writeLine(`reconnect next: ${nextReconnect}`);
  context.writeLine(context.reconnectMetricsLine());
}

function writeHelp(context: CliCommandContext): void {
  [
    "commands:",
    "  /help                     this help",
    "  /list                     refresh sessions",
    "  /attach <pane-id>         attach to pane",
    "  /detach                   detach current pane",
    "  /enable                   enable input",
    "  /disable                  disable input",
    "  /reconnect                retry connection now",
    "  /status                   show runtime status",
    "  /profiles                 list profiles",
    "  /profile                  profile management (add/use/rm/token)",
    "  /health                   check server health snapshot",
    "  /backend                  show detected local backend",
    "  /open [cmd]               open local backend shell",
    "  /token                    authenticate with token",
    "  /quit, /exit              close client",
    "  type raw input             send to attached pane",
    "  env: CRC_TOKEN, COMMANDRELAY_TOKEN, CRC_TOKEN_FILE, COMMANDRELAY_TOKEN_FILE"
  ].forEach(context.writeLine);
}
