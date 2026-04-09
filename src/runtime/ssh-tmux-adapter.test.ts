/**
 * @file Unit tests for SSH tmux runtime adapter behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SshTmuxAdapter } from "./ssh-tmux-adapter.js";

const PANE_FORMAT = [
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{pane_index}",
  "#{pane_id}",
  "#{pane_title}",
  "#{pane_current_command}"
].join("\t");

interface RunCommandMockCall {
  command: string;
  args: string[];
  timeoutMs: number;
}

interface RunCommandWithInputMockCall {
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
}

interface RunCommandMock {
  calls: RunCommandMockCall[];
  withInputCalls: RunCommandWithInputMockCall[];
  runCommandImpl: (command: string, args: string[], timeoutMs?: number) => Promise<string>;
  runCommandWithInputImpl: (
    command: string,
    args: string[],
    input: string,
    timeoutMs?: number
  ) => Promise<string>;
}

/**
 * Creates a deterministic async command runner mock with queued outcomes.
 *
 * @param outcomes Ordered command outcomes.
 * @returns Mock command runner and call log.
 */
function createRunCommandMock(
  outcomes: Array<{ stdout?: string; error?: unknown }>,
  withInputOutcomes: Array<{ stdout?: string; error?: unknown }> = []
): RunCommandMock {
  const queue = [...outcomes];
  const calls: RunCommandMockCall[] = [];
  const withInputQueue = [...withInputOutcomes];
  const withInputCalls: RunCommandWithInputMockCall[] = [];

  return {
    calls,
    withInputCalls,
    async runCommandImpl(command: string, args: string[], timeoutMs = 5000): Promise<string> {
      calls.push({ command, args, timeoutMs });
      const next = queue.shift();
      if (!next) {
        throw new Error("runCommand called with no queued outcome");
      }
      if (next.error) {
        throw next.error;
      }
      return next.stdout ?? "";
    },
    async runCommandWithInputImpl(
      command: string,
      args: string[],
      input: string,
      timeoutMs = 5000
    ): Promise<string> {
      withInputCalls.push({ command, args, input, timeoutMs });
      const next = withInputQueue.shift();
      if (!next) {
        throw new Error("runCommandWithInput called with no queued outcome");
      }
      if (next.error) {
        throw next.error;
      }
      return next.stdout ?? "";
    }
  };
}

test("isAvailable runs tmux -V over ssh with configured options", async () => {
  const mock = createRunCommandMock([{ stdout: "tmux 3.4" }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    sshPort: 2201,
    sshCommand: "ssh-custom",
    strictHostKeyChecking: false,
    connectTimeoutSeconds: 12,
    commandTimeoutMs: 1234,
    runCommandImpl: mock.runCommandImpl
  });

  assert.equal(adapter.backendId, "ssh-tmux");
  assert.equal(await adapter.isAvailable(), true);
  assert.deepEqual(mock.calls, [
    {
      command: "ssh-custom",
      args: [
        "-p",
        "2201",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=12",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "dev@host.example",
        "tmux -V"
      ],
      timeoutMs: 1234
    }
  ]);
});

test("isAvailable returns false on ssh command failure", async () => {
  const mock = createRunCommandMock([{ error: new Error("spawn ENOENT") }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    runCommandImpl: mock.runCommandImpl
  });

  assert.equal(await adapter.isAvailable(), false);
  assert.deepEqual(mock.calls[0], {
    command: "ssh",
    args: [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "StrictHostKeyChecking=yes",
      "dev@host.example",
      "tmux -V"
    ],
    timeoutMs: 6000
  });
});

test("isAvailable always includes -T to disable pseudo-tty", async () => {
  const strictMock = createRunCommandMock([{ stdout: "tmux 3.4" }]);
  const strictAdapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    strictHostKeyChecking: true,
    runCommandImpl: strictMock.runCommandImpl
  });
  const looseMock = createRunCommandMock([{ stdout: "tmux 3.4" }]);
  const looseAdapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    strictHostKeyChecking: false,
    runCommandImpl: looseMock.runCommandImpl
  });

  await strictAdapter.isAvailable();
  await looseAdapter.isAvailable();

  assert.equal(strictMock.calls[0].args.includes("-T"), true);
  assert.equal(looseMock.calls[0].args.includes("-T"), true);
});

test("isAvailable adds UserKnownHostsFile override when strict host key checking is disabled", async () => {
  const mock = createRunCommandMock([{ stdout: "tmux 3.4" }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    strictHostKeyChecking: false,
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.isAvailable();

  assert.equal(mock.calls[0].args.includes("StrictHostKeyChecking=no"), true);
  assert.equal(mock.calls[0].args.includes("UserKnownHostsFile=/dev/null"), true);
});

test("knownHostsFile override is honored when strict host key checking is disabled", async () => {
  const mock = createRunCommandMock([{ stdout: "tmux 3.4" }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    strictHostKeyChecking: false,
    knownHostsFile: "/tmp/known_hosts",
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.isAvailable();

  assert.equal(mock.calls[0].args.includes("StrictHostKeyChecking=no"), true);
  assert.equal(mock.calls[0].args.includes("UserKnownHostsFile=/tmp/known_hosts"), true);
  assert.equal(mock.calls[0].args.includes("UserKnownHostsFile=/dev/null"), false);
});

test("isAvailable verifies expected host fingerprint before tmux ssh command", async () => {
  const keyscanOutput = "host.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBASEKEY";
  const mock = createRunCommandMock(
    [{ stdout: keyscanOutput }, { stdout: "tmux 3.4" }],
    [{ stdout: "256 SHA256:matchFp123 host.example (ED25519)" }]
  );
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    sshPort: 2201,
    expectedFingerprintSha256: "SHA256:matchFp123",
    runCommandImpl: mock.runCommandImpl,
    runCommandWithInputImpl: mock.runCommandWithInputImpl
  });

  assert.equal(await adapter.isAvailable(), true);
  assert.deepEqual(mock.calls[0], {
    command: "ssh-keyscan",
    args: ["-T", "8", "-p", "2201", "host.example"],
    timeoutMs: 6000
  });
  assert.deepEqual(mock.withInputCalls[0], {
    command: "ssh-keygen",
    args: ["-lf", "-"],
    input: keyscanOutput,
    timeoutMs: 6000
  });
  assert.equal(mock.calls[1].command, "ssh");
});

test("capturePane fails closed on expected fingerprint mismatch", async () => {
  const mock = createRunCommandMock(
    [{ stdout: "host.example ssh-ed25519 AAAAC3NzaMismatch" }],
    [{ stdout: "256 SHA256:wrongFp123 host.example (ED25519)" }]
  );
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    expectedFingerprintSha256: "SHA256:expectedFp123",
    runCommandImpl: mock.runCommandImpl,
    runCommandWithInputImpl: mock.runCommandWithInputImpl
  });

  await assert.rejects(async () => adapter.capturePane("%1", 10), /SSH host fingerprint mismatch/);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].command, "ssh-keyscan");
});

test("capturePane fails closed when fingerprint cannot be resolved", async () => {
  const mock = createRunCommandMock(
    [{ stdout: "host.example ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ..." }],
    [{ stdout: "malformed fingerprint output" }]
  );
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    expectedFingerprintSha256: "SHA256:expected-fp",
    runCommandImpl: mock.runCommandImpl,
    runCommandWithInputImpl: mock.runCommandWithInputImpl
  });

  await assert.rejects(
    async () => adapter.capturePane("%1", 10),
    /did not contain SHA256 fingerprints/
  );
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].command, "ssh-keyscan");
});

test("listPanes parses tmux rows and uses escaped format argument", async () => {
  const mock = createRunCommandMock([
    {
      stdout: [
        "dev\t1\teditor\t0\t%1\t\tbash",
        "prod\tnot-number\tops\tnan\t%2\tOps\tzsh",
        "incomplete-row"
      ].join("\n")
    }
  ]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "ops@remote",
    runCommandImpl: mock.runCommandImpl
  });

  const panes = await adapter.listPanes();

  assert.deepEqual(mock.calls[0], {
    command: "ssh",
    args: [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "StrictHostKeyChecking=yes",
      "ops@remote",
      `tmux list-panes -a -F '${PANE_FORMAT}'`
    ],
    timeoutMs: 6000
  });
  assert.deepEqual(panes, [
    {
      sessionName: "dev",
      windowIndex: 1,
      windowName: "editor",
      paneIndex: 0,
      paneId: "%1",
      paneTitle: "",
      currentCommand: "bash"
    },
    {
      sessionName: "prod",
      windowIndex: 0,
      windowName: "ops",
      paneIndex: 0,
      paneId: "%2",
      paneTitle: "Ops",
      currentCommand: "zsh"
    }
  ]);
});

test("listPanes returns empty rows for remote tmux no-server errors", async () => {
  const mock = createRunCommandMock([
    {
      error: {
        stderr: "ssh remote: no server running on /tmp/tmux-1000/default"
      }
    }
  ]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    runCommandImpl: mock.runCommandImpl
  });

  const panes = await adapter.listPanes();

  assert.deepEqual(panes, []);
});

test("listPanes rethrows non-no-server errors", async () => {
  const expectedError = new Error("permission denied");
  const mock = createRunCommandMock([{ error: expectedError }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    runCommandImpl: mock.runCommandImpl
  });

  await assert.rejects(async () => adapter.listPanes(), expectedError);
});

test("capturePane clamps fromLine to at most -1", async () => {
  const mock = createRunCommandMock([{ stdout: "first" }, { stdout: "second" }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.capturePane("%9", 0);
  await adapter.capturePane("%9", 120);

  assert.deepEqual(mock.calls.map((call) => call.args.at(-1)), [
    "tmux capture-pane -p -J -S -1 -t %9",
    "tmux capture-pane -p -J -S -120 -t %9"
  ]);
});

test("sendInput preserves newlines and safely escapes literal segments", async () => {
  const mock = createRunCommandMock([{ stdout: "" }, { stdout: "" }, { stdout: "" }, { stdout: "" }]);
  const adapter = new SshTmuxAdapter({
    sshTarget: "dev@host.example",
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.sendInput("%3", "echo 'hello world'\n\npwd && whoami");

  assert.equal(mock.calls.length, 4);
  assert.deepEqual(mock.calls[0].args, [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=yes",
    "dev@host.example",
    "tmux send-keys -t %3 -l -- 'echo '\"'\"'hello world'\"'\"''"
  ]);
  assert.deepEqual(mock.calls[1].args, [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=yes",
    "dev@host.example",
    "tmux send-keys -t %3 C-m"
  ]);
  assert.deepEqual(mock.calls[2].args, [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=yes",
    "dev@host.example",
    "tmux send-keys -t %3 C-m"
  ]);
  assert.deepEqual(mock.calls[3].args, [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=yes",
    "dev@host.example",
    "tmux send-keys -t %3 -l -- 'pwd && whoami'"
  ]);
});

test("constructor validates required target, optional port, and connect timeout", () => {
  assert.throws(() => new SshTmuxAdapter({ sshTarget: "   " }), /sshTarget must be a non-empty string/);
  assert.throws(
    () => new SshTmuxAdapter({ sshTarget: "dev@host", sshPort: 0 }),
    /sshPort must be a positive number/
  );
  assert.throws(
    () => new SshTmuxAdapter({ sshTarget: "dev@host", connectTimeoutSeconds: 0 }),
    /connectTimeoutSeconds must be an integer between 1 and 60/
  );
  assert.throws(
    () => new SshTmuxAdapter({ sshTarget: "dev@host", connectTimeoutSeconds: 61 }),
    /connectTimeoutSeconds must be an integer between 1 and 60/
  );
  assert.throws(
    () => new SshTmuxAdapter({ sshTarget: "dev@host", connectTimeoutSeconds: 8.5 }),
    /connectTimeoutSeconds must be an integer between 1 and 60/
  );
});
