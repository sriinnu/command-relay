import assert from "node:assert/strict";
import test from "node:test";
import { SshTmuxRuntimeAdapter } from "../src/index.js";

interface RunCommandMockCall {
  command: string;
  args: string[];
  timeoutMs?: number;
}

function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>) {
  const queue = [...outcomes];
  const calls: RunCommandMockCall[] = [];

  return {
    calls,
    async runCommandImpl(
      command: string,
      args: string[],
      options: number | { timeoutMs?: number } = {}
    ): Promise<string> {
      calls.push({ command, args, timeoutMs: typeof options === "number" ? options : options.timeoutMs });
      const next = queue.shift();
      if (!next) throw new Error("runCommand called with no queued outcome");
      if (next.error) throw next.error;
      return next.stdout ?? "";
    }
  };
}

test("constructor validates target and timeout settings", () => {
  assert.throws(() => new SshTmuxRuntimeAdapter({ sshTarget: "   " }), /sshTarget must be a non-empty string/);
  assert.throws(
    () => new SshTmuxRuntimeAdapter({ sshTarget: "dev@host", sshPort: 0 }),
    /sshPort must be a positive number/
  );
  assert.throws(
    () => new SshTmuxRuntimeAdapter({ sshTarget: "dev@host", connectTimeoutSeconds: 61 }),
    /connectTimeoutSeconds must be an integer between 1 and 60/
  );
});

test("startCommand launches a detached remote tmux session and returns attach metadata", async () => {
  const mock = createRunCommandMock([
    { stdout: "feature-branch\t0\tFix tests\t0\t%11\t\tbash" }
  ]);
  const adapter = new SshTmuxRuntimeAdapter({
    sshTarget: "dev@example.com",
    sshPort: 2222,
    sshCommand: "ssh",
    strictHostKeyChecking: false,
    commandTimeoutMs: 900,
    runCommandImpl: mock.runCommandImpl
  });

  const pane = await adapter.startCommand({
    title: "Feature Branch",
    cwd: "/tmp/work",
    command: "npm test",
    shell: "/bin/bash"
  });

  assert.deepEqual(mock.calls[0], {
    command: "ssh",
    args: [
      "-p",
      "2222",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "dev@example.com",
      "tmux new-session -d -P -F '#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_title}\t#{pane_current_command}' -s feature-branch -n 'Feature Branch' -c /tmp/work '/bin/bash -lc '\"'\"'npm test'\"'\"''"
    ],
    timeoutMs: 900
  });
  assert.deepEqual(pane, {
    sessionName: "feature-branch",
    windowIndex: 0,
    windowName: "Fix tests",
    paneIndex: 0,
    paneId: "%11",
    paneTitle: "",
    currentCommand: "bash",
    attachCommand:
      "ssh -p 2222 -t -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null dev@example.com 'tmux attach-session -t feature-branch'"
  });
});

test("stopCommand kills the remote tmux session over ssh", async () => {
  const mock = createRunCommandMock([{ stdout: "" }]);
  const adapter = new SshTmuxRuntimeAdapter({
    sshTarget: "dev@example.com",
    sshPort: 2222,
    sshCommand: "ssh",
    strictHostKeyChecking: false,
    commandTimeoutMs: 900,
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.stopCommand({ paneId: "%11", sessionName: "feature-branch" });

  assert.deepEqual(mock.calls[0], {
    command: "ssh",
    args: [
      "-p",
      "2222",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "dev@example.com",
      "tmux kill-session -t feature-branch"
    ],
    timeoutMs: 900
  });
});
