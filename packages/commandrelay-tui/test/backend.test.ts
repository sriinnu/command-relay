import assert from "node:assert/strict";
import test from "node:test";
import { detectTerminalBackend, isBackend } from "../src/backend.js";

test("isBackend accepts supported launcher ids", () => {
  assert.equal(isBackend("terminal.app"), true);
  assert.equal(isBackend("windows-terminal"), true);
  assert.equal(isBackend("console"), true);
  assert.equal(isBackend("putty"), false);
});

test("detectTerminalBackend prefers Terminal.app on macOS when osascript is present", () => {
  const backend = detectTerminalBackend(null, {
    platform: "darwin",
    env: { TERM_PROGRAM: "Apple_Terminal" },
    hasExecutable: (name) => name === "osascript"
  });

  assert.equal(backend, "terminal.app");
});

test("detectTerminalBackend prefers Windows Terminal on win32 hosts", () => {
  const backend = detectTerminalBackend(null, {
    platform: "win32",
    env: { WT_SESSION: "1" },
    hasExecutable: (name) => name === "wt" || name === "powershell.exe"
  });

  assert.equal(backend, "windows-terminal");
});

test("detectTerminalBackend falls back to console for remote ssh sessions without a local launcher", () => {
  const backend = detectTerminalBackend(null, {
    platform: "linux",
    env: { SSH_CONNECTION: "1" },
    hasExecutable: () => false
  });

  assert.equal(backend, "console");
});
