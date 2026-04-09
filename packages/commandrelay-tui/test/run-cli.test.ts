import assert from "node:assert/strict";
import test from "node:test";

import type { RunLedgerRecord } from "@commandrelay/run-core";
import { executeRunCliInvocation, parseRunCliArgs } from "../src/run-cli.js";

test("parseRunCliArgs parses run with runtime, detach, and opener", () => {
  const invocation = parseRunCliArgs([
    "run",
    "--runtime",
    "managed",
    "--title",
    "Fix tests",
    "--detach",
    "--open",
    "ghostty",
    "--",
    "npm test"
  ]);

  assert.deepEqual(invocation, {
    kind: "run",
    runDirectory: undefined,
    spec: {
      runtime: "managed",
      command: "npm test",
      title: "Fix tests",
      cwd: undefined,
      shell: undefined,
      detach: true,
      openTarget: "ghostty"
    }
  });
});

test("parseRunCliArgs captures run-dir for durable run commands", () => {
  const invocation = parseRunCliArgs([
    "run",
    "--runtime",
    "managed",
    "--run-dir",
    "/tmp/runs",
    "--",
    "npm test"
  ]);

  assert.deepEqual(invocation, {
    kind: "run",
    runDirectory: "/tmp/runs",
    spec: {
      runtime: "managed",
      command: "npm test",
      title: undefined,
      cwd: undefined,
      shell: undefined,
      detach: true,
      openTarget: null
    }
  });
});

test("parseRunCliArgs normalizes wt alias for runs open", () => {
  const invocation = parseRunCliArgs(["runs", "open", "run_123", "--open", "wt"]);
  assert.deepEqual(invocation, {
    kind: "runs-open",
    runId: "run_123",
    openTarget: "windows-terminal",
    runDirectory: undefined
  });
});

test("parseRunCliArgs accepts ssh-tmux runtime", () => {
  const invocation = parseRunCliArgs(["run", "--runtime", "ssh-tmux", "--", "npm test"]);
  assert.deepEqual(invocation, {
    kind: "run",
    runDirectory: undefined,
    spec: {
      runtime: "ssh-tmux",
      command: "npm test",
      title: undefined,
      cwd: undefined,
      shell: undefined,
      detach: true,
      openTarget: null
    }
  });
});

test("parseRunCliArgs accepts ssh-tmux runtime", () => {
  const invocation = parseRunCliArgs([
    "run",
    "--runtime",
    "ssh-tmux",
    "--",
    "codex exec fix remote"
  ]);

  assert.deepEqual(invocation, {
    kind: "run",
    runDirectory: undefined,
    spec: {
      runtime: "ssh-tmux",
      command: "codex exec fix remote",
      title: undefined,
      cwd: undefined,
      shell: undefined,
      detach: true,
      openTarget: null
    }
  });
});

test("parseRunCliArgs parses runs stop and reconcile", () => {
  assert.deepEqual(parseRunCliArgs(["runs", "stop", "run_123"]), {
    kind: "runs-stop",
    runId: "run_123",
    runDirectory: undefined
  });
  assert.deepEqual(parseRunCliArgs(["runs", "reconcile", "run_123", "--run-dir", "/tmp/runs"]), {
    kind: "runs-reconcile",
    runId: "run_123",
    runDirectory: "/tmp/runs"
  });
});

test("executeRunCliInvocation starts a run and opens the requested host terminal", async () => {
  const lines: string[] = [];
  const launchCalls: Array<{ backend: string; command: string }> = [];
  const orchestrator = {
    async startRun(): Promise<RunLedgerRecord> {
      return {
        runId: "run_abc",
        runtime: "managed",
        title: "Fix tests",
        command: "npm test",
        cwd: "/tmp/work",
        shell: "/bin/bash",
        detach: true,
        status: "running",
        statusReason: null,
        paneId: "sess-1",
        sessionName: "Fix tests [sess-1]",
        attachCommand: "oly attach sess-1",
        openTarget: "ghostty",
        runDirectory: "/tmp/runs",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
        lastSeenAt: "2026-04-09T00:00:00.000Z",
        endedAt: null,
        exitCode: null,
        ledgerPath: "/tmp/run.json"
      };
    },
    async listRuns() {
      return [];
    },
    async inspectRun() {
      return null;
    },
    async stopRun() {
      return null;
    },
    async reconcileRun() {
      return null;
    },
    async reconcileRuns() {
      return [];
    }
  };

  await executeRunCliInvocation(
    {
      kind: "run",
      spec: {
        runtime: "managed",
        command: "npm test",
        detach: true,
        openTarget: "ghostty"
      }
    },
    (line) => lines.push(line),
    {
      orchestrator,
      launchLocalTerminal: (backend, command) => launchCalls.push({ backend, command }),
      detectOpenBackend: () => "console",
      canLaunchBackend: () => true
    }
  );

  assert.deepEqual(launchCalls, [{ backend: "ghostty", command: "oly attach sess-1" }]);
  assert.equal(lines[0], "run started: run_abc");
  assert.equal(lines.at(-1), "opened ghostty for run_abc");
});

test("executeRunCliInvocation refuses to open non-running runs", async () => {
  const lines: string[] = [];
  const orchestrator = {
    async startRun() {
      throw new Error("not used");
    },
    async listRuns() {
      return [];
    },
    async inspectRun(): Promise<RunLedgerRecord> {
      return {
        runId: "run_lost",
        runtime: "managed",
        title: "Fix tests",
        command: "npm test",
        cwd: "/tmp/work",
        shell: "/bin/bash",
        detach: true,
        status: "lost",
        statusReason: "pane-missing-during-reconciliation",
        paneId: "sess-1",
        sessionName: "Fix tests [sess-1]",
        attachCommand: "oly attach sess-1",
        openTarget: "ghostty",
        runDirectory: "/tmp/runs",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
        lastSeenAt: "2026-04-09T00:00:00.000Z",
        endedAt: "2026-04-09T00:05:00.000Z",
        exitCode: null,
        ledgerPath: "/tmp/run.json"
      };
    },
    async stopRun() {
      return null;
    },
    async reconcileRun() {
      return null;
    },
    async reconcileRuns() {
      return [];
    }
  };

  await executeRunCliInvocation(
    { kind: "runs-open", runId: "run_lost", openTarget: "ghostty" },
    (line) => lines.push(line),
    {
      orchestrator,
      launchLocalTerminal: () => {
        throw new Error("should not open");
      },
      detectOpenBackend: () => "console",
      canLaunchBackend: () => true
    }
  );

  assert.equal(lines[0], "cannot open run_lost: status is lost");
});

test("executeRunCliInvocation stops a run through the orchestrator", async () => {
  const lines: string[] = [];
  const orchestrator = {
    async startRun() {
      throw new Error("not used");
    },
    async listRuns() {
      return [];
    },
    async inspectRun() {
      return null;
    },
    async stopRun(): Promise<RunLedgerRecord> {
      return {
        runId: "run_stop",
        runtime: "managed",
        title: "Fix tests",
        command: "npm test",
        cwd: "/tmp/work",
        shell: "/bin/bash",
        detach: true,
        status: "stopped",
        statusReason: "operator-stopped",
        paneId: "sess-1",
        sessionName: "Fix tests [sess-1]",
        attachCommand: "oly attach sess-1",
        openTarget: null,
        runDirectory: "/tmp/runs",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:10:00.000Z",
        lastSeenAt: "2026-04-09T00:10:00.000Z",
        endedAt: "2026-04-09T00:10:00.000Z",
        exitCode: null,
        ledgerPath: "/tmp/run.json"
      };
    },
    async reconcileRun() {
      return null;
    },
    async reconcileRuns() {
      return [];
    }
  };

  await executeRunCliInvocation(
    { kind: "runs-stop", runId: "run_stop" },
    (line) => lines.push(line),
    { orchestrator, detectOpenBackend: () => "console", canLaunchBackend: () => true }
  );

  assert.deepEqual(lines, ["run stopped: run_stop", "status: stopped", "reason: operator-stopped"]);
});

test("executeRunCliInvocation rejects unavailable explicit open targets", async () => {
  const orchestrator = {
    async startRun(): Promise<RunLedgerRecord> {
      return {
        runId: "run_abc",
        runtime: "managed",
        title: "Fix tests",
        command: "npm test",
        cwd: "/tmp/work",
        shell: "/bin/bash",
        detach: true,
        status: "running",
        statusReason: null,
        paneId: "sess-1",
        sessionName: "Fix tests [sess-1]",
        attachCommand: "oly attach sess-1",
        openTarget: "ghostty",
        runDirectory: "/tmp/runs",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
        lastSeenAt: "2026-04-09T00:00:00.000Z",
        endedAt: null,
        exitCode: null,
        ledgerPath: "/tmp/run.json"
      };
    },
    async listRuns() {
      return [];
    },
    async inspectRun() {
      return null;
    },
    async stopRun() {
      return null;
    },
    async reconcileRun() {
      return null;
    },
    async reconcileRuns() {
      return [];
    }
  };

  await assert.rejects(
    async () =>
      await executeRunCliInvocation(
        {
          kind: "run",
          spec: {
            runtime: "managed",
            command: "npm test",
            detach: true,
            openTarget: "ghostty"
          }
        },
        () => undefined,
        {
          orchestrator,
          detectOpenBackend: () => "console",
          canLaunchBackend: () => false
        }
      ),
    /requested open target is unavailable/
  );
});

test("executeRunCliInvocation rejects ssh-tmux without COMMANDRELAY_SSH_TARGET", async () => {
  const previous = process.env.COMMANDRELAY_SSH_TARGET;
  delete process.env.COMMANDRELAY_SSH_TARGET;
  await assert.rejects(
    async () =>
      await executeRunCliInvocation(
        {
          kind: "run",
          spec: {
            runtime: "ssh-tmux",
            command: "npm test",
            detach: true,
            openTarget: null
          }
        },
        () => undefined
      ),
    /COMMANDRELAY_SSH_TARGET/
  );
  process.env.COMMANDRELAY_SSH_TARGET = previous;
});
