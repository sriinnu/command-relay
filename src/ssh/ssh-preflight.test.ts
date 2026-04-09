/**
 * @file Unit tests for SSH client preflight availability checks.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { checkSshClientAvailability } from "./ssh-preflight.js";

interface RunCommandMockCall {
  command: string;
  args: string[];
  timeoutMs: number;
}

interface RunCommandMock {
  calls: RunCommandMockCall[];
  runCommandImpl: (command: string, args: string[], timeoutMs?: number) => Promise<string>;
}

/**
 * Creates a deterministic runCommand mock with queued outcomes.
 *
 * @param outcomes Ordered outcomes to consume on each call.
 * @returns Mock command runner and call capture.
 */
function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>): RunCommandMock {
  const queue = [...outcomes];
  const calls: RunCommandMockCall[] = [];

  return {
    calls,
    async runCommandImpl(command: string, args: string[], timeoutMs = 5000): Promise<string> {
      calls.push({ command, args, timeoutMs });
      const next = queue.shift();
      if (!next) {
        throw new Error("runCommand called without queued outcome");
      }

      if (next.error) {
        throw next.error;
      }

      return next.stdout ?? "";
    }
  };
}

test("returns available=true with version when ssh -V succeeds", async () => {
  const mock = createRunCommandMock([{ stdout: "OpenSSH_9.9p2, LibreSSL 3.4.0" }]);

  const result = await checkSshClientAvailability({ runCommandImpl: mock.runCommandImpl });

  assert.deepEqual(result, {
    available: true,
    version: "OpenSSH_9.9p2",
    reason: null
  });
  assert.deepEqual(mock.calls, [
    {
      command: "ssh",
      args: ["-V"],
      timeoutMs: 5000
    }
  ]);
});

test("returns failure when command succeeds but no version token is present", async () => {
  const mock = createRunCommandMock([{ stdout: "ssh command executed without banner output" }]);

  const result = await checkSshClientAvailability({ runCommandImpl: mock.runCommandImpl });

  assert.deepEqual(result, {
    available: false,
    version: null,
    reason: "ssh_version_check_failed"
  });
});

test("uses custom command and timeout options", async () => {
  const mock = createRunCommandMock([{ stdout: "OpenSSH_8.8p1" }]);

  await checkSshClientAvailability({
    sshCommand: "ssh-custom",
    timeoutMs: 1234,
    runCommandImpl: mock.runCommandImpl
  });

  assert.deepEqual(mock.calls, [
    {
      command: "ssh-custom",
      args: ["-V"],
      timeoutMs: 1234
    }
  ]);
});

test("extracts version from thrown error message/stderr when command fails", async () => {
  const error = Object.assign(new Error("Command failed: ssh -V\nOpenSSH_9.3p2, LibreSSL 3.3.6"), {
    stderr: "OpenSSH_9.3p2, LibreSSL 3.3.6",
    code: 1
  });
  const mock = createRunCommandMock([{ error }]);

  const result = await checkSshClientAvailability({ runCommandImpl: mock.runCommandImpl });

  assert.deepEqual(result, {
    available: true,
    version: "OpenSSH_9.3p2",
    reason: null
  });
});

test("returns deterministic reason when ssh binary is missing", async () => {
  const error = Object.assign(new Error("spawn ssh ENOENT"), { code: "ENOENT" });
  const mock = createRunCommandMock([{ error }]);

  const result = await checkSshClientAvailability({ runCommandImpl: mock.runCommandImpl });

  assert.deepEqual(result, {
    available: false,
    version: null,
    reason: "ssh_command_not_found"
  });
});

test("returns deterministic timeout reason when version check times out", async () => {
  const error = Object.assign(new Error("Command timed out after 5000ms"), { code: "ETIMEDOUT" });
  const mock = createRunCommandMock([{ error }]);

  const result = await checkSshClientAvailability({ runCommandImpl: mock.runCommandImpl });

  assert.deepEqual(result, {
    available: false,
    version: null,
    reason: "ssh_version_check_timeout"
  });
});

test("returns generic failure reason for other command errors", async () => {
  const error = Object.assign(new Error("unexpected exit code"), { code: 2, stderr: "usage: ssh" });
  const mock = createRunCommandMock([{ error }]);

  const result = await checkSshClientAvailability({ runCommandImpl: mock.runCommandImpl });

  assert.deepEqual(result, {
    available: false,
    version: null,
    reason: "ssh_version_check_failed"
  });
});
