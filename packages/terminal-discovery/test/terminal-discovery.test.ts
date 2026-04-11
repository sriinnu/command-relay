import assert from "node:assert/strict";
import test from "node:test";
import { detectAvailableTerminals, detectTerminalEnvironment } from "../src/index.js";

test("detectTerminalEnvironment recognizes Apple Terminal and tmux preference", () => {
  const snapshot = detectTerminalEnvironment({
    platform: "darwin",
    env: { TERM_PROGRAM: "Apple_Terminal" },
    hasExecutable: (name) => name === "tmux"
  });

  assert.equal(snapshot.platform, "macos");
  assert.equal(snapshot.terminalKind, "terminal.app");
  assert.deepEqual(snapshot.preferredRuntimeBackends, ["tmux"]);
});

test("detectTerminalEnvironment recognizes windows terminal and powershell", () => {
  const snapshot = detectTerminalEnvironment({
    platform: "win32",
    env: { WT_SESSION: "1", PSModulePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules" }
  });

  assert.equal(snapshot.platform, "windows");
  assert.equal(snapshot.terminalKind, "windows-terminal");
  assert.equal(snapshot.shellFamily, "powershell");
  assert.deepEqual(snapshot.preferredRuntimeBackends, ["managed"]);
});

test("detectAvailableTerminals includes ssh and wsl markers", () => {
  const terminals = detectAvailableTerminals({
    platform: "linux",
    env: { SSH_CONNECTION: "1", WSL_DISTRO_NAME: "Ubuntu" },
    hasExecutable: (name) => name === "tmux" || name === "cmux"
  });

  assert.deepEqual(terminals, ["tmux", "cmux", "ssh", "wsl", "console"]);
});
