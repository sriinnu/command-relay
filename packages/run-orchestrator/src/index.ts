/**
 * @file Durable local run orchestration over launch-capable runtime backends.
 */

import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

import type { RunLedgerRecord, RunSpec, RunRuntime } from "@commandrelay/run-core";
import { resolveDefaultRuntimeShell, type RunnableRuntimeBackend, type RuntimePane } from "@commandrelay/runtime-core";

import {
  ensureRunEntryDirectory,
  loadRunLedgerRecord,
  loadRunLedgerRecords,
  resolveRunDirectory,
  resolveRunExitMarkerPath,
  resolveRunProjectRoot,
  resolveRunLedgerPath,
  saveRunLedgerRecord
} from "./ledger.js";
import { buildRunWrappedCommand, loadRunExitMarker } from "./run-exit-marker.js";

/**
 * Constructor options for {@link RunOrchestrator}.
 */
export interface RunOrchestratorOptions {
  managedRuntime?: RunnableRuntimeBackend;
  tmuxRuntime?: RunnableRuntimeBackend;
  sshTmuxRuntime?: RunnableRuntimeBackend;
  runDirectory?: string;
  idFactory?: () => string;
  now?: () => Date;
}

/**
 * Durable local run controller backed by the runtime packages.
 */
export class RunOrchestrator {
  private readonly runtimeById: Partial<Record<RunRuntime, RunnableRuntimeBackend>>;
  private readonly runDirectory: string | undefined;
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  /**
   * @param options Optional runtime overrides and deterministic test hooks.
   */
  constructor(options: RunOrchestratorOptions = {}) {
    this.runtimeById = {
      managed: options.managedRuntime,
      tmux: options.tmuxRuntime,
      "ssh-tmux": options.sshTmuxRuntime
    };
    this.runDirectory = options.runDirectory?.trim() ? path.resolve(options.runDirectory) : undefined;
    this.idFactory = options.idFactory ?? createRunId;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Starts a durable local run and persists its ledger record.
   *
   * @param spec Requested run specification.
   * @returns Persisted run ledger record.
   */
  async startRun(spec: RunSpec): Promise<RunLedgerRecord> {
    const runtime = this.runtimeById[spec.runtime];
    if (!runtime) {
      throw new Error(`runtime backend is not configured for durable runs: ${spec.runtime}`);
    }
    const runId = this.idFactory();
    const title = normalizeRunTitle(spec.title, spec.command);
    const cwd = path.resolve(spec.cwd ?? process.cwd());
    const runDirectory = this.runDirectory ?? resolveRunDirectory({ baseDir: resolveRunProjectRoot(cwd) });
    const shell = spec.shell?.trim() || resolveDefaultRuntimeShell();
    const detach = spec.detach ?? true;
    await ensureRunEntryDirectory(runId, { runDirectory });
    const exitMarkerPath = resolveRunExitMarkerPath(runId, { runDirectory });
    const startedPane = await runtime.startCommand({
      title: buildLaunchTitle(title, runId),
      cwd,
      command: buildRunWrappedCommand(spec.command, shell, exitMarkerPath),
      shell
    });

    const timestamp = this.now().toISOString();
    const record: RunLedgerRecord = {
      runId,
      runtime: spec.runtime,
      title,
      command: spec.command,
      cwd,
      shell,
      detach,
      status: "running",
      statusReason: null,
      paneId: startedPane.paneId,
      sessionName: startedPane.sessionName,
      attachCommand: startedPane.attachCommand,
      openTarget: spec.openTarget ?? null,
      runDirectory,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSeenAt: timestamp,
      endedAt: null,
      exitCode: null,
      ledgerPath: resolveRunLedgerPath(runId, { runDirectory })
    };

    await saveRunLedgerRecord(record);
    return record;
  }

  /**
   * Lists persisted durable runs.
   *
   * @returns Sorted run records, newest first.
   */
  async listRuns(): Promise<RunLedgerRecord[]> {
    const records = await loadRunLedgerRecords({ runDirectory: this.runDirectory });
    return await this.reconcileRecords(records);
  }

  /**
   * Loads one durable run record.
   *
   * @param runId Durable run identifier.
   * @returns Run record or `null` when missing.
   */
  async inspectRun(runId: string): Promise<RunLedgerRecord | null> {
    const record = await loadRunLedgerRecord(runId, { runDirectory: this.runDirectory });
    if (!record) {
      return null;
    }
    return await this.reconcileRecord(record);
  }

  /**
   * Reconciles all persisted durable runs against live runtime state.
   *
   * @returns Reconciled run records.
   */
  async reconcileRuns(): Promise<RunLedgerRecord[]> {
    return await this.listRuns();
  }

  /**
   * Reconciles one durable run against live runtime state.
   *
   * @param runId Durable run identifier.
   * @returns Reconciled run record or `null` when missing.
   */
  async reconcileRun(runId: string): Promise<RunLedgerRecord | null> {
    return await this.inspectRun(runId);
  }

  /**
   * Stops a durable run through its owning runtime backend.
   *
   * @param runId Durable run identifier.
   * @returns Updated run record or `null` when missing.
   */
  async stopRun(runId: string): Promise<RunLedgerRecord | null> {
    const record = await loadRunLedgerRecord(runId, { runDirectory: this.runDirectory });
    if (!record) {
      return null;
    }

    const reconciled = await this.reconcileRecord(record);
    if (reconciled.status !== "starting" && reconciled.status !== "running") {
      return reconciled;
    }

    const runtime = this.runtimeById[reconciled.runtime];
    if (!runtime) {
      throw new Error(`runtime backend is not configured for durable runs: ${reconciled.runtime}`);
    }

    await runtime.stopCommand(toRuntimeHandle(reconciled));
    const timestamp = this.now().toISOString();
    const stoppedRecord: RunLedgerRecord = {
      ...reconciled,
      status: "stopped",
      statusReason: "operator-stopped",
      updatedAt: timestamp,
      lastSeenAt: timestamp,
      endedAt: timestamp
    };
    await saveRunLedgerRecord(stoppedRecord);
    return stoppedRecord;
  }

  private async reconcileRecords(records: RunLedgerRecord[]): Promise<RunLedgerRecord[]> {
    return await Promise.all(records.map(async (record) => await this.reconcileRecord(record)));
  }

  private async reconcileRecord(record: RunLedgerRecord): Promise<RunLedgerRecord> {
    if (!isActiveStatus(record.status)) {
      return record;
    }

    const exitedRecord = await this.reconcileExitedRecord(record);
    if (exitedRecord) {
      return exitedRecord;
    }

    const runtime = this.runtimeById[record.runtime];
    if (!runtime) {
      return record;
    }

    let panes: RuntimePane[];
    try {
      panes = await runtime.listPanes();
    } catch {
      return record;
    }

    const livePane = panes.find((pane) => matchesRunPane(record, pane));
    if (!livePane) {
      const lostRecord: RunLedgerRecord = {
        ...record,
        status: "lost",
        statusReason: "pane-missing-during-reconciliation",
        updatedAt: this.now().toISOString(),
        endedAt: record.endedAt ?? this.now().toISOString()
      };
      await saveRunLedgerRecord(lostRecord);
      return lostRecord;
    }

    const lastSeenAt = this.now().toISOString();
    const attachCommand = runtime.buildAttachCommand(livePane);
    if (
      record.status === "running" &&
      record.attachCommand === attachCommand &&
      record.sessionName === readSessionName(livePane) &&
      record.lastSeenAt !== null
    ) {
      return record;
    }

    const runningRecord: RunLedgerRecord = {
      ...record,
      status: "running",
      statusReason: null,
      sessionName: readSessionName(livePane) || record.sessionName,
      attachCommand,
      lastSeenAt
    };
    await saveRunLedgerRecord(runningRecord);
    return runningRecord;
  }

  private async reconcileExitedRecord(record: RunLedgerRecord): Promise<RunLedgerRecord | null> {
    const marker = await loadRunExitMarker(resolveRunExitMarkerPath(record.runId, { runDirectory: record.runDirectory }));
    if (!marker) {
      return null;
    }

    const finalizedAt = marker.endedAt ?? this.now().toISOString();
    const finalizedRecord: RunLedgerRecord = {
      ...record,
      status: marker.exitCode === 0 ? "completed" : "failed",
      statusReason: "process-exited",
      updatedAt: finalizedAt,
      endedAt: finalizedAt,
      exitCode: marker.exitCode
    };
    await saveRunLedgerRecord(finalizedRecord);
    return finalizedRecord;
  }
}

function normalizeRunTitle(title: string | undefined, command: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 80);
  const derived = command.trim().replace(/\s+/g, " ");
  return (derived || "commandrelay-run").slice(0, 80);
}

function buildLaunchTitle(title: string, runId: string): string {
  const suffix = runId.replace(/^run_/, "").slice(-6);
  return `${title}-${suffix}`;
}

function createRunId(): string {
  return `run_${crypto.randomBytes(6).toString("hex")}`;
}

function isActiveStatus(status: RunLedgerRecord["status"]): boolean {
  return status === "starting" || status === "running";
}

function matchesRunPane(record: RunLedgerRecord, pane: RuntimePane): boolean {
  const paneId = typeof pane.paneId === "string" ? pane.paneId.trim() : "";
  if (paneId && paneId === record.paneId) {
    return true;
  }
  const sessionName = readSessionName(pane);
  return Boolean(sessionName && sessionName === record.sessionName);
}

function readSessionName(pane: RuntimePane): string {
  return typeof pane.sessionName === "string" ? pane.sessionName.trim() : "";
}

function toRuntimeHandle(record: RunLedgerRecord): RuntimePane {
  return {
    paneId: record.paneId,
    sessionName: record.sessionName
  };
}
