"use strict";
const CFG = { heartbeatMs: 15000, heartbeatStaleMs: 45000, reconnectBaseMs: 1000, reconnectMaxMs: 12000, requestTimeoutMs: 8000, maxOutputChars: 200000, maxCommandHistory: 60 };
const S = {
  ws: null, desired: false, manualClose: false, ready: false, authed: false,
  reconnectAttempt: 0, reconnectTimer: null, heartbeatTimer: null, lastHeartbeatAckAt: 0,
  requestSeq: 0, pending: new Map(), panes: [], sessions: [], activePane: null,
  lastSeqByPane: new Map(), inputEnabled: false, globalInputDisabled: false, commands: []
};
const UI = {};
document.addEventListener("DOMContentLoaded", () => {
  cacheUI();
  bindEvents();
  UI.wsUrl.value = defaultWsUrl();
  setStatus("disconnected", "Waiting for connection.");
  renderSessions();
  renderCommands();
  updateControls();
});
function cacheUI() {
  const ids = ["connection-form", "ws-url", "auth-token", "auto-reconnect", "connect-btn", "disconnect-btn", "refresh-sessions-btn", "clear-output-btn", "connection-badge", "status-text", "sessions-meta", "sessions-list", "active-pane-label", "enable-input-btn", "disable-input-btn", "output-log", "command-form", "command-input", "append-newline", "override-lane", "send-command-btn", "command-history", "toast-region"];
  for (const id of ids) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing node #${id}`);
    UI[id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = node;
  }
}
function bindEvents() {
  UI.connectionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (S.ws?.readyState === WebSocket.OPEN && !S.ready) return requestAuth();
    await connect(false);
  });
  UI.disconnectBtn.addEventListener("click", async () => { await disconnect(); });
  UI.refreshSessionsBtn.addEventListener("click", async () => { if (S.ready) setStatus("connected", "Refreshing sessions..."); await refreshSessions(false); });
  UI.clearOutputBtn.addEventListener("click", () => { UI.outputLog.textContent = ""; setStatus(UI.connectionBadge.getAttribute("data-state") || "disconnected", "Output cleared."); notify("Output cleared.", "info"); UI.outputLog.focus(); });
  UI.sessionsList.addEventListener("click", async (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-pane-id]") : null;
    const paneId = target?.getAttribute("data-pane-id");
    if (paneId) await attachPane(paneId, false);
  });
  UI.enableInputBtn.addEventListener("click", async () => { await requestPolicy("enable_input"); });
  UI.disableInputBtn.addEventListener("click", async () => { await requestPolicy("disable_input"); });
  UI.commandForm.addEventListener("submit", async (event) => { event.preventDefault(); await sendCommand(); });
  UI.commandInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); await sendCommand(); }
  });
  UI.commandInput.addEventListener("input", updateControls);
  window.addEventListener("beforeunload", () => {
    S.desired = false;
    S.manualClose = true;
    stopHeartbeat();
    if (S.ws && S.ws.readyState <= WebSocket.OPEN) S.ws.close();
  });
}
function defaultWsUrl() {
  if (location.protocol === "http:" || location.protocol === "https:") {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${location.host}/ws`;
  }
  return "ws://127.0.0.1:8787/ws";
}
async function connect(isReconnect) {
  const url = UI.wsUrl.value.trim();
  if (!url) return notify("WebSocket URL is required.", "warn");
  if (S.ws && (S.ws.readyState === WebSocket.CONNECTING || S.ws.readyState === WebSocket.OPEN)) return notify("A websocket is already active.", "warn");
  S.desired = true;
  S.manualClose = false;
  S.ready = false;
  S.authed = false;
  setStatus(isReconnect ? "reconnecting" : "connecting", isReconnect ? "Reconnecting..." : "Connecting...");
  try {
    S.ws = new WebSocket(url);
    S.ws.addEventListener("open", () => setStatus(isReconnect ? "reconnecting" : "connecting", "Socket open. Waiting for hello..."));
    S.ws.addEventListener("message", async (event) => { await onMessage(event.data); });
    S.ws.addEventListener("close", onClose);
    S.ws.addEventListener("error", () => notify("WebSocket transport error.", "error"));
  } catch (error) {
    notify(`Connection failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    setStatus("disconnected", "Connection failed.");
    scheduleReconnect("Failed to create websocket.");
  }
  updateControls();
}
async function onMessage(raw) {
  let message;
  try { message = JSON.parse(typeof raw === "string" ? raw : String(raw)); } catch { return notify("Invalid JSON from relay.", "warn"); }
  if (!isRecord(message) || typeof message.type !== "string" || !isRecord(message.payload)) return;
  settlePending(message);
  switch (message.type) {
    case "hello":
      applyPolicy(message.payload);
      if (!message.payload.requiresAuth) {
        S.authed = true;
        onAuthenticated();
      } else {
        await requestAuth();
      }
      break;
    case "auth_ok":
      S.authed = true;
      onAuthenticated();
      notify("Authenticated.", "info");
      break;
    case "auth_error":
      S.authed = false;
      S.desired = false;
      setStatus("disconnected", "Authentication failed.");
      notify("Auth failed. Verify token.", "error");
      break;
    case "session_list":
      applySessionList(message.payload);
      break;
    case "output":
      applyOutput(message.payload);
      break;
    case "policy_update":
      applyPolicy(message.payload);
      break;
    case "heartbeat_ack":
      S.lastHeartbeatAckAt = Date.now();
      break;
    case "error":
      if (!message.requestId) notify(`Server error: ${String(message.payload.code ?? "unknown")}`, "error");
      break;
    default:
      break;
  }
  updateControls();
}
async function requestAuth() {
  const token = UI.authToken.value.trim();
  if (!token) {
    setStatus("connecting", "Token required. Enter token and submit again.");
    return notify("Relay requires auth token.", "warn");
  }
  try {
    await sendRequest("auth", { token }, { timeoutMs: 7500, prefix: "auth" });
  } catch (error) {
    notify(`Auth request failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
function onAuthenticated() {
  if (S.ready) return;
  S.ready = true;
  S.reconnectAttempt = 0;
  clearReconnectTimer();
  S.lastHeartbeatAckAt = Date.now();
  setStatus("connected", "Connected and synchronized.");
  startHeartbeat();
  void refreshSessions(true);
  if (S.activePane) void attachPane(S.activePane, true);
}
function onClose() {
  rejectAllPending("Connection closed.");
  stopHeartbeat();
  S.ws = null;
  S.ready = false;
  S.authed = false;
  S.inputEnabled = false;
  S.globalInputDisabled = false; S.activePane = null; renderSessions();
  if (S.manualClose || !S.desired) {
    S.manualClose = false;
    setStatus("disconnected", "Disconnected.");
    return updateControls();
  }
  scheduleReconnect("Relay connection lost.");
  updateControls();
}
function scheduleReconnect(reason) {
  clearReconnectTimer();
  if (!S.desired || !UI.autoReconnect.checked) return setStatus("disconnected", `${reason} Auto reconnect is disabled.`);
  S.reconnectAttempt += 1;
  const base = Math.min(CFG.reconnectMaxMs, CFG.reconnectBaseMs * (2 ** (S.reconnectAttempt - 1)));
  const delay = base + Math.floor(Math.random() * 350);
  setStatus("reconnecting", `${reason} Retry in ${(delay / 1000).toFixed(1)}s (attempt ${S.reconnectAttempt}).`);
  S.reconnectTimer = window.setTimeout(() => { void connect(true); }, delay);
}
function clearReconnectTimer() {
  if (S.reconnectTimer !== null) {
    clearTimeout(S.reconnectTimer);
    S.reconnectTimer = null;
  }
}
function startHeartbeat() {
  stopHeartbeat();
  S.heartbeatTimer = window.setInterval(async () => {
    if (!S.ready) return;
    try {
      await sendRequest("heartbeat", {}, { timeoutMs: 6000, prefix: "hb", silent: true });
      S.lastHeartbeatAckAt = Date.now();
    } catch {
      if (Date.now() - S.lastHeartbeatAckAt > CFG.heartbeatStaleMs) {
        notify("Heartbeat stale. Reconnecting socket.", "warn");
        if (S.ws && S.ws.readyState <= WebSocket.OPEN) S.ws.close();
      }
    }
  }, CFG.heartbeatMs);
}
function stopHeartbeat() {
  if (S.heartbeatTimer !== null) {
    clearInterval(S.heartbeatTimer);
    S.heartbeatTimer = null;
  }
}
async function refreshSessions(silent) {
  if (!S.ready) {
    if (!silent) notify("Connect first to list sessions.", "warn");
    return;
  }
  try {
    await sendRequest("list_sessions", {}, { prefix: "list", silent });
  } catch (error) {
    if (!silent) notify(`Session refresh failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
function applySessionList(payload) {
  S.panes = Array.isArray(payload.panes) ? payload.panes.filter(isRecord) : [];
  S.sessions = Array.isArray(payload.sessions) ? payload.sessions.filter(isRecord) : [];
  renderSessions();
}
async function attachPane(paneId, isResume) {
  if (!S.ready) return notify("Connect and authenticate before attach.", "warn");
  if (S.activePane && S.activePane !== paneId) {
    void sendRequest("detach", { paneId: S.activePane }, { timeoutMs: 3000, prefix: "detach", silent: true }).catch(() => {});
  }
  const payload = { paneId };
  const lastSeq = S.lastSeqByPane.get(paneId);
  if (Number.isInteger(lastSeq)) payload.lastSeq = Number(lastSeq);
  try {
    await sendRequest("attach", payload, { timeoutMs: 10000, prefix: "attach" });
    S.activePane = paneId;
    UI.activePaneLabel.textContent = `Attached pane: ${paneId}`;
    renderSessions();
    if (!isResume) notify(`Attached to ${paneId}.`, "info"); UI.commandInput.focus();
  } catch (error) {
    notify(`Attach failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
  updateControls();
}
async function requestPolicy(type) {
  if (!S.ready) return notify("Connect first to change input state.", "warn");
  try {
    await sendRequest(type, {}, { prefix: type });
  } catch (error) {
    notify(`Policy update failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
function applyPolicy(payload) {
  S.inputEnabled = Boolean(payload.inputEnabled);
  S.globalInputDisabled = Boolean(payload.globalInputDisabled);
}
function applyOutput(payload) {
  const paneId = typeof payload.paneId === "string" ? payload.paneId : "";
  const chunk = typeof payload.chunk === "string" ? payload.chunk : "";
  const streamSeq = typeof payload.streamSeq === "number" ? payload.streamSeq : null;
  if (paneId && Number.isInteger(streamSeq)) S.lastSeqByPane.set(paneId, streamSeq);
  if (!paneId || paneId !== S.activePane || !chunk) return;
  const nearBottom = UI.outputLog.scrollTop + UI.outputLog.clientHeight >= UI.outputLog.scrollHeight - 24;
  UI.outputLog.textContent += chunk;
  if (UI.outputLog.textContent.length > CFG.maxOutputChars) UI.outputLog.textContent = UI.outputLog.textContent.slice(-CFG.maxOutputChars);
  if (nearBottom) UI.outputLog.scrollTop = UI.outputLog.scrollHeight;
}
async function sendCommand() {
  if (!S.ready || !S.activePane) return notify("Attach to a pane first.", "warn");
  if (!S.inputEnabled || S.globalInputDisabled) return notify("Input is disabled.", "warn");
  const appendNewline = UI.appendNewline.checked;
  const override = UI.overrideLane.checked;
  let text = UI.commandInput.value;
  if (appendNewline && !text.endsWith("\n")) text += "\n";
  if (!text.trim()) return notify("Command is empty.", "warn");
  UI.commandInput.value = "";
  const row = addCommand(S.activePane, text);
  renderCommands();
  updateControls();
  const payload = { paneId: S.activePane, data: text };
  if (override) payload.override = true;
  try {
    const ack = await sendRequest("input", payload, { timeoutMs: 10000, prefix: "input" });
    row.state = "sent";
    row.detail = `ack bytes=${String(ack.payload.bytes ?? "")}`;
  } catch (error) {
    row.state = "failed";
    row.detail = error instanceof Error ? error.message : String(error);
  }
  renderCommands();
  UI.commandInput.focus();
}
function addCommand(paneId, text) {
  const row = { id: `cmd-${Date.now()}-${Math.floor(Math.random() * 1000)}`, paneId, text, state: "pending", detail: null, at: Date.now() };
  S.commands.unshift(row);
  if (S.commands.length > CFG.maxCommandHistory) S.commands = S.commands.slice(0, CFG.maxCommandHistory);
  return row;
}
function renderSessions() {
  UI.sessionsList.innerHTML = "";
  const paneById = new Map();
  for (const pane of S.panes) if (typeof pane.paneId === "string") paneById.set(pane.paneId, pane);
  if (!S.sessions.length) {
    const item = document.createElement("li");
    item.className = "session-card";
    item.textContent = "No sessions loaded.";
    UI.sessionsList.appendChild(item);
    UI.sessionsMeta.textContent = "No active sessions.";
    return;
  }
  let paneCount = 0;
  for (const session of S.sessions) {
    const sessionName = typeof session.sessionName === "string" ? session.sessionName : "unknown";
    const paneIds = Array.isArray(session.paneIds) ? session.paneIds.filter((id) => typeof id === "string") : [];
    paneCount += paneIds.length;
    const card = document.createElement("li");
    card.className = "session-card";
    const title = document.createElement("h3");
    title.textContent = sessionName;
    card.appendChild(title);
    for (const paneId of paneIds) {
      const pane = paneById.get(paneId) ?? {};
      const row = document.createElement("div");
      row.className = "pane-row";
      const command = typeof pane.currentCommand === "string" ? pane.currentCommand : (typeof pane.paneCurrentCommand === "string" ? pane.paneCurrentCommand : "");
      const windowName = typeof pane.windowName === "string" ? pane.windowName : "";
      const paneTitle = typeof pane.paneTitle === "string" && pane.paneTitle.trim() ? pane.paneTitle : "Untitled pane";
      const meta = document.createElement("div");
      meta.innerHTML = `<strong>${escapeHtml(paneId)}</strong> ${escapeHtml(paneTitle)}<div class="pane-meta">${escapeHtml(windowName)}${command ? ` - ${escapeHtml(command)}` : ""}</div>`;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-pane-id", paneId);
      button.textContent = paneId === S.activePane ? "Attached" : "Attach";
      button.disabled = paneId === S.activePane;
      row.append(meta, button);
      card.appendChild(row);
    }
    UI.sessionsList.appendChild(card);
  }
  UI.sessionsMeta.textContent = `${S.sessions.length} sessions, ${paneCount} panes.`;
}
function renderCommands() {
  UI.commandHistory.innerHTML = "";
  for (const cmd of S.commands) {
    const li = document.createElement("li");
    li.className = "command-item";
    li.setAttribute("data-state", cmd.state);
    const time = new Date(cmd.at).toLocaleTimeString();
    li.innerHTML = `<div class="command-top"><span>${escapeHtml(time)} · ${escapeHtml(cmd.paneId)}</span><span class="command-state">${escapeHtml(cmd.state)}</span></div><code>${escapeHtml(cmd.text)}</code>${cmd.detail ? `<div class="pane-meta">${escapeHtml(cmd.detail)}</div>` : ""}`;
    UI.commandHistory.appendChild(li);
  }
}
function sendRequest(type, payload, options = {}) {
  if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("WebSocket is not connected."));
  const requestId = `${options.prefix ?? type}-${Date.now()}-${++S.requestSeq}`;
  const timeoutMs = options.timeoutMs ?? CFG.requestTimeoutMs;
  const envelope = { v: 1, type, requestId, timestamp: Date.now(), payload };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      S.pending.delete(requestId);
      reject(new Error(`Request timeout for ${type}`));
    }, timeoutMs);
    S.pending.set(requestId, { resolve, reject, timer, silent: Boolean(options.silent) });
    try {
      S.ws.send(JSON.stringify(envelope));
    } catch (error) {
      clearTimeout(timer);
      S.pending.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
function settlePending(message) {
  if (!message.requestId) return;
  const pending = S.pending.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  S.pending.delete(message.requestId);
  if (message.type === "error" || message.type === "auth_error") {
    const code = typeof message.payload.code === "string" ? message.payload.code : "unknown_error";
    const details = typeof message.payload.message === "string" ? ` (${message.payload.message})` : "";
    const err = new Error(`${code}${details}`);
    pending.reject(err);
    if (!pending.silent) notify(`Request failed: ${err.message}`, "error");
    return;
  }
  pending.resolve(message);
}
function rejectAllPending(reason) {
  for (const [id, pending] of S.pending.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    S.pending.delete(id);
  }
}
async function disconnect() {
  S.desired = false;
  S.manualClose = true;
  clearReconnectTimer();
  stopHeartbeat();
  if (S.ready) {
    try {
      await sendRequest("disconnect", {}, { timeoutMs: 2500, prefix: "disconnect", silent: true });
    } catch {
      // ignore graceful shutdown failures
    }
  }
  if (S.ws && S.ws.readyState <= WebSocket.OPEN) S.ws.close(); S.activePane = null; renderSessions();
  setStatus("disconnected", "Disconnected.");
  updateControls();
}
function updateControls() {
  const socketActive = Boolean(S.ws && S.ws.readyState <= WebSocket.OPEN);
  const connecting = Boolean(S.ws && S.ws.readyState === WebSocket.CONNECTING);
  const openNotReady = Boolean(S.ws && S.ws.readyState === WebSocket.OPEN && !S.ready);
  const canSend = S.ready && Boolean(S.activePane) && S.inputEnabled && !S.globalInputDisabled && Boolean(UI.commandInput.value.trim());
  toggleDisabled(UI.connectBtn, connecting || (socketActive && S.ready));
  UI.connectBtn.textContent = openNotReady ? "Authenticate" : "Connect";
  toggleDisabled(UI.disconnectBtn, !socketActive);
  toggleDisabled(UI.refreshSessionsBtn, !S.ready);
  toggleDisabled(UI.enableInputBtn, !S.ready || S.globalInputDisabled);
  toggleDisabled(UI.disableInputBtn, !S.ready || !S.inputEnabled);
  toggleDisabled(UI.sendCommandBtn, !canSend);
  if (!S.activePane) UI.activePaneLabel.textContent = "Not attached to a pane.";
}
function toggleDisabled(node, disabled) {
  node.toggleAttribute("disabled", disabled); node.setAttribute("aria-disabled", disabled ? "true" : "false");
}
function setStatus(state, text) {
  const label = state.charAt(0).toUpperCase() + state.slice(1);
  UI.connectionBadge.setAttribute("data-state", state); UI.connectionBadge.textContent = label; UI.connectionBadge.setAttribute("aria-label", `Connection ${label.toLowerCase()}`);
  UI.statusText.textContent = text; document.title = `${label} - CommandRelay Control`;
}
function notify(text, level) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("data-level", level);
  toast.setAttribute("role", level === "error" ? "alert" : "status");
  toast.textContent = text;
  UI.toastRegion.prepend(toast);
  while (UI.toastRegion.children.length > 5) {
    const last = UI.toastRegion.lastElementChild;
    if (last) last.remove();
  }
  setTimeout(() => toast.remove(), level === "error" ? 6000 : 4200);
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
