import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import type { RunnableRuntimeBackend, RuntimeLaunchRequest, RuntimePane, RuntimeStartedPane } from "@commandrelay/runtime-core";

import { RunOrchestrator } from "../src/index.js";
import { resolveRunDirectory, resolveRunExitMarkerPath } from "../src/ledger.js";

interface RuntimeHarness {
  backend: RunnableRuntimeBackend;
  calls: RuntimeLaunchRequest[];
  stopCalls: RuntimePane[];
  setLivePanes: (panes: RuntimePane[]) => void;
}

function createRuntimeHarness(backendId: "managed" | "tmux", paneId: string): RuntimeHarness {
  const calls: RuntimeLaunchRequest[] = [];
  const stopCalls: RuntimePane[] = [];
  let livePanes: RuntimePane[] = [];
  return {
    calls,
    stopCalls,
    setLivePanes(panes: RuntimePane[]): void {
      livePanes = panes;
    },
    backend: {
      backendId,
      async isAvailable(): Promise<boolean> {
        return true;
      },
      async listPanes(): Promise<RuntimePane[]> {
        return livePanes;
      },
      async capturePane(): Promise<string> {
        return "";
      },
      async sendInput(): Promise<void> {},
      async startCommand(request: RuntimeLaunchRequest): Promise<RuntimeStartedPane> {
        calls.push(request);
        return {
          paneId,
          sessionName: `${backendId}-session`,
          attachCommand: `${backendId} attach ${paneId}`
        };
      },
      async stopCommand(pane: RuntimePane): Promise<void> {
        stopCalls.push(pane);
      },
      buildAttachCommand(pane: RuntimePane): string {
        return `${backendId} attach ${pane.paneId}`;
      }
    }
  };
}

function createSshRuntimeHarness(paneId: string): RuntimeHarness {
  const calls: RuntimeLaunchRequest[] = [];
  const stopCalls: RuntimePane[] = [];
  let livePanes: RuntimePane[] = [];
  return {
    calls,
    stopCalls,
    setLivePanes(panes: RuntimePane[]): void {
      livePanes = panes;
    },
    backend: {
      backendId: "ssh-tmux",
      async isAvailable(): Promise<boolean> {
        return true;
      },
      async listPanes(): Promise<RuntimePane[]> {
        return livePanes;
      },
      async capturePane(): Promise<string> {
        return "";
      },
      async sendInput(): Promise<void> {},
      async startCommand(request: RuntimeLaunchRequest): Promise<RuntimeStartedPane> {
        calls.push(request);
        return {
          paneId,
          sessionName: "ssh-session",
          attachCommand: "ssh dev@example.com 'tmux attach-session -t ssh-session'"
        };
      },
      async stopCommand(pane: RuntimePane): Promise<void> {
        stopCalls.push(pane);
      },
      buildAttachCommand(): string {
        return "ssh dev@example.com 'tmux attach-session -t ssh-session'";
      }
    }
  };
}

test("startRun persists a durable ledger record", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-"));
  process.env.COMMANDRELAY_RUN_DIR = tempRoot;
  const managed = createRuntimeHarness("managed", "sess-1");
  const orchestrator = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_fixed",
    now: () => new Date("2026-04-09T12:00:00.000Z")
  });

  const record = await orchestrator.startRun({
    runtime: "managed",
    command: "npm test",
    title: "Fix tests",
    cwd: "/tmp/work",
    shell: "/bin/bash",
    detach: true,
    openTarget: "ghostty"
  });

  assert.equal(managed.calls[0]?.title, "Fix tests-fixed");
  assert.equal(managed.calls[0]?.cwd, "/tmp/work");
  assert.equal(managed.calls[0]?.shell, "/bin/bash");
  assert.match(managed.calls[0]?.command ?? "", /npm test/);
  assert.match(managed.calls[0]?.command ?? "", /exitCode/);
  assert.equal(record.runId, "run_fixed");
  assert.equal(record.attachCommand, "managed attach sess-1");
  assert.equal(record.ledgerPath, path.join(tempRoot, "run_fixed", "run.json"));
  assert.equal(record.runDirectory, tempRoot);

  const persisted = JSON.parse(await readFile(record.ledgerPath, "utf8")) as { runId: string; title: string };
  assert.equal(persisted.runId, "run_fixed");
  assert.equal(persisted.title, "Fix tests");

  delete process.env.COMMANDRELAY_RUN_DIR;
});

test("listRuns returns persisted records newest first", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-"));
  process.env.COMMANDRELAY_RUN_DIR = tempRoot;
  const managed = createRuntimeHarness("managed", "sess-1");
  const orchestrator = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_a",
    now: () => new Date("2026-04-09T10:00:00.000Z")
  });
  await orchestrator.startRun({ runtime: "managed", command: "echo one" });

  const orchestratorTwo = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_b",
    now: () => new Date("2026-04-09T11:00:00.000Z")
  });
  await orchestratorTwo.startRun({ runtime: "managed", command: "echo two" });

  const records = await orchestrator.listRuns();
  assert.deepEqual(records.map((record) => record.runId), ["run_b", "run_a"]);

  delete process.env.COMMANDRELAY_RUN_DIR;
});

test("startRun supports ssh-tmux runtime when configured", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-"));
  process.env.COMMANDRELAY_RUN_DIR = tempRoot;
  const ssh = createSshRuntimeHarness("%11");
  const orchestrator = new RunOrchestrator({
    sshTmuxRuntime: ssh.backend,
    idFactory: () => "run_123abc",
    now: () => new Date("2026-04-09T12:00:00.000Z")
  });

  const record = await orchestrator.startRun({
    runtime: "ssh-tmux",
    command: "npm test",
    title: "Remote Branch",
    cwd: "/tmp/work"
  });

  assert.equal(ssh.calls[0]?.title, "Remote Branch-123abc");
  assert.equal(record.runtime, "ssh-tmux");
  assert.equal(record.paneId, "%11");

  delete process.env.COMMANDRELAY_RUN_DIR;
});

test("startRun derives the ledger root from the run cwd project root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-root-"));
  const projectRoot = path.join(tempRoot, "project");
  const nestedRoot = path.join(projectRoot, "nested", "child");
  await mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await mkdir(nestedRoot, { recursive: true });
  delete process.env.COMMANDRELAY_RUN_DIR;

  const managed = createRuntimeHarness("managed", "sess-2");
  const orchestrator = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_nested",
    now: () => new Date("2026-04-09T12:00:00.000Z")
  });

  const record = await orchestrator.startRun({
    runtime: "managed",
    command: "npm test",
    cwd: nestedRoot
  });

  assert.equal(record.runDirectory, path.join(projectRoot, ".commandrelay", "runs"));
  assert.equal(resolveRunDirectory({ baseDir: nestedRoot }), path.join(projectRoot, ".commandrelay", "runs"));
});

test("inspectRun reconciles missing panes into lost status", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-"));
  process.env.COMMANDRELAY_RUN_DIR = tempRoot;
  const managed = createRuntimeHarness("managed", "sess-1");
  managed.setLivePanes([]);
  const orchestrator = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_lost",
    now: () => new Date("2026-04-09T12:00:00.000Z")
  });

  await orchestrator.startRun({ runtime: "managed", command: "npm test" });
  const lost = await orchestrator.inspectRun("run_lost");

  assert.equal(lost?.status, "lost");
  assert.equal(lost?.statusReason, "pane-missing-during-reconciliation");
  assert.equal(lost?.endedAt, "2026-04-09T12:00:00.000Z");

  delete process.env.COMMANDRELAY_RUN_DIR;
});

test("stopRun stops an active runtime and persists stopped status", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-"));
  process.env.COMMANDRELAY_RUN_DIR = tempRoot;
  const managed = createRuntimeHarness("managed", "sess-stop");
  managed.setLivePanes([{ paneId: "sess-stop", sessionName: "managed-session" }]);
  const orchestrator = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_stop",
    now: () => new Date("2026-04-09T12:00:00.000Z")
  });

  await orchestrator.startRun({ runtime: "managed", command: "npm test" });
  const stopped = await orchestrator.stopRun("run_stop");

  assert.equal(stopped?.status, "stopped");
  assert.equal(stopped?.statusReason, "operator-stopped");
  assert.deepEqual(managed.stopCalls, [{ paneId: "sess-stop", sessionName: "managed-session" }]);

  delete process.env.COMMANDRELAY_RUN_DIR;
});

test("inspectRun reconciles exit markers into completed status", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-run-"));
  process.env.COMMANDRELAY_RUN_DIR = tempRoot;
  const managed = createRuntimeHarness("managed", "sess-exit");
  managed.setLivePanes([]);
  const orchestrator = new RunOrchestrator({
    managedRuntime: managed.backend,
    idFactory: () => "run_exit",
    now: () => new Date("2026-04-09T12:00:00.000Z")
  });

  await orchestrator.startRun({ runtime: "managed", command: "npm test" });
  await writeFile(
    resolveRunExitMarkerPath("run_exit", { runDirectory: tempRoot }),
    JSON.stringify({ exitCode: 0, endedAt: "2026-04-09T12:03:00.000Z" }),
    "utf8"
  );

  const completed = await orchestrator.inspectRun("run_exit");

  assert.equal(completed?.status, "completed");
  assert.equal(completed?.statusReason, "process-exited");
  assert.equal(completed?.exitCode, 0);
  assert.equal(completed?.endedAt, "2026-04-09T12:03:00.000Z");

  delete process.env.COMMANDRELAY_RUN_DIR;
});
