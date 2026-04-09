/**
 * @file Ledger helpers for durable local CommandRelay runs.
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import type { RunLedgerRecord } from "@commandrelay/run-core";

const RUN_DIR_ENV = "COMMANDRELAY_RUN_DIR";
const RUN_FILE_NAME = "run.json";
const RUN_EXIT_FILE_NAME = "exit.json";
const RUN_STATUS_VALUES = new Set(["starting", "running", "completed", "stopped", "failed", "lost"]);
const RUN_RUNTIME_VALUES = new Set(["managed", "tmux", "ssh-tmux"]);

/**
 * Optional ledger-path resolution overrides.
 */
export interface RunLedgerPathOptions {
  baseDir?: string;
  runDirectory?: string;
}

/**
 * Error raised when a durable run ledger entry exists but is unreadable or invalid.
 */
export class RunLedgerCorruptError extends Error {
  readonly runId: string;
  readonly ledgerPath: string;

  /**
   * @param runId Durable run identifier.
   * @param ledgerPath Absolute path to the corrupt ledger file.
   * @param cause Underlying failure.
   */
  constructor(runId: string, ledgerPath: string, cause: unknown) {
    super(`run ledger is corrupt for ${runId}: ${ledgerPath}`, { cause });
    this.name = "RunLedgerCorruptError";
    this.runId = runId;
    this.ledgerPath = ledgerPath;
  }
}

/**
 * Resolves the absolute directory used to persist durable runs.
 *
 * @param options Optional base-directory overrides.
 * @returns Absolute run-directory path.
 */
export function resolveRunDirectory(options: RunLedgerPathOptions = {}): string {
  const configured = process.env[RUN_DIR_ENV]?.trim();
  if (configured) return path.resolve(configured);
  if (options.runDirectory?.trim()) return path.resolve(options.runDirectory);
  return path.join(resolveRunProjectRoot(options.baseDir), ".commandrelay", "runs");
}

/**
 * Resolves the per-run directory for the supplied run id.
 *
 * @param runId Durable run identifier.
 * @param options Optional base-directory overrides.
 * @returns Absolute path to the run directory.
 */
export function resolveRunEntryDirectory(runId: string, options: RunLedgerPathOptions = {}): string {
  return path.join(resolveRunDirectory(options), runId);
}

/**
 * Ensures the per-run directory exists before launch-time side effects write into it.
 *
 * @param runId Durable run identifier.
 * @param options Optional base-directory overrides.
 * @returns Absolute run entry directory.
 */
export async function ensureRunEntryDirectory(runId: string, options: RunLedgerPathOptions = {}): Promise<string> {
  const runEntryDirectory = resolveRunEntryDirectory(runId, options);
  await mkdir(runEntryDirectory, { recursive: true });
  return runEntryDirectory;
}

/**
 * Resolves the absolute JSON ledger file for the supplied run id.
 *
 * @param runId Durable run identifier.
 * @param options Optional base-directory overrides.
 * @returns Absolute path to the run ledger file.
 */
export function resolveRunLedgerPath(runId: string, options: RunLedgerPathOptions = {}): string {
  return path.join(resolveRunEntryDirectory(runId, options), RUN_FILE_NAME);
}

/**
 * Resolves the exit marker file written by wrapped durable runs.
 *
 * @param runId Durable run identifier.
 * @param options Optional base-directory overrides.
 * @returns Absolute path to the exit marker file.
 */
export function resolveRunExitMarkerPath(runId: string, options: RunLedgerPathOptions = {}): string {
  return path.join(resolveRunEntryDirectory(runId, options), RUN_EXIT_FILE_NAME);
}

/**
 * Resolves the nearest stable project root used for default run storage.
 *
 * @param baseDir Optional base directory to search upward from.
 * @returns Project root directory.
 */
export function resolveRunProjectRoot(baseDir = process.cwd()): string {
  let current = path.resolve(baseDir);
  while (true) {
    if (hasProjectRootMarker(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(baseDir);
    }
    current = parent;
  }
}

/**
 * Persists one run ledger record to disk.
 *
 * @param record Durable run record.
 */
export async function saveRunLedgerRecord(record: RunLedgerRecord): Promise<void> {
  const runDirectory = path.dirname(record.ledgerPath);
  await mkdir(runDirectory, { recursive: true });
  const tempPath = path.join(runDirectory, `${RUN_FILE_NAME}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, JSON.stringify(record, null, 2), "utf8");
  await rename(tempPath, record.ledgerPath);
}

/**
 * Loads all durable run records present on disk.
 *
 * @param options Optional base-directory overrides.
 * @returns Sorted run records, newest first.
 */
export async function loadRunLedgerRecords(options: RunLedgerPathOptions = {}): Promise<RunLedgerRecord[]> {
  const root = resolveRunDirectory(options);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const records: RunLedgerRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      try {
        const record = await loadRunLedgerRecord(entry.name, options);
        if (record) {
          records.push(record);
        }
      } catch (error) {
        if (error instanceof RunLedgerCorruptError) {
          await quarantineRunLedgerRecord(entry.name, options);
          continue;
        }
        throw error;
      }
    }
    return records
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

/**
 * Loads one durable run record by id.
 *
 * @param runId Durable run identifier.
 * @param options Optional base-directory overrides.
 * @returns Run record or `null` when missing/invalid.
 */
export async function loadRunLedgerRecord(
  runId: string,
  options: RunLedgerPathOptions = {}
): Promise<RunLedgerRecord | null> {
  const ledgerPath = resolveRunLedgerPath(runId, options);
  try {
    const raw = await readFile(ledgerPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeRunLedgerRecord(parsed, ledgerPath);
    if (!normalized) {
      throw new RunLedgerCorruptError(runId, ledgerPath, new TypeError("ledger record failed validation"));
    }
    return normalized;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error instanceof RunLedgerCorruptError ? error : new RunLedgerCorruptError(runId, ledgerPath, error);
  }
}

async function quarantineRunLedgerRecord(runId: string, options: RunLedgerPathOptions): Promise<void> {
  const ledgerPath = resolveRunLedgerPath(runId, options);
  try {
    const quarantinePath = path.join(
      path.dirname(ledgerPath),
      `${RUN_FILE_NAME}.corrupt-${Date.now()}`
    );
    await rename(ledgerPath, quarantinePath);
  } catch {
    // Best-effort quarantine only; callers already know the record is unusable.
  }
}

function normalizeRunLedgerRecord(value: unknown, ledgerPath: string): RunLedgerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.runId !== "string" ||
    typeof record.runtime !== "string" ||
    !RUN_RUNTIME_VALUES.has(record.runtime) ||
    typeof record.title !== "string" ||
    typeof record.command !== "string" ||
    typeof record.cwd !== "string" ||
    typeof record.shell !== "string" ||
    typeof record.detach !== "boolean" ||
    typeof record.status !== "string" ||
    !RUN_STATUS_VALUES.has(record.status) ||
    typeof record.paneId !== "string" ||
    typeof record.sessionName !== "string" ||
    typeof record.attachCommand !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.ledgerPath !== "string"
  ) {
    return null;
  }

  return {
    runId: record.runId,
    runtime: record.runtime,
    title: record.title,
    command: record.command,
    cwd: record.cwd,
    shell: record.shell,
    detach: record.detach,
    status: record.status,
    statusReason: typeof record.statusReason === "string" ? record.statusReason : null,
    paneId: record.paneId,
    sessionName: record.sessionName,
    attachCommand: record.attachCommand,
    openTarget: typeof record.openTarget === "string" ? record.openTarget : null,
    runDirectory: typeof record.runDirectory === "string" ? record.runDirectory : inferRunDirectoryFromLedgerPath(ledgerPath),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSeenAt: typeof record.lastSeenAt === "string" ? record.lastSeenAt : inferLastSeenAt(record.status, record.updatedAt),
    endedAt: typeof record.endedAt === "string" ? record.endedAt : inferEndedAt(record.status, record.updatedAt),
    exitCode: typeof record.exitCode === "number" && Number.isFinite(record.exitCode) ? Math.trunc(record.exitCode) : null,
    ledgerPath
  } as RunLedgerRecord;
}

function hasProjectRootMarker(candidate: string): boolean {
  return (
    existsSync(path.join(candidate, ".git")) ||
    existsSync(path.join(candidate, "pnpm-workspace.yaml")) ||
    existsSync(path.join(candidate, "package.json"))
  );
}

function inferRunDirectoryFromLedgerPath(ledgerPath: string): string {
  return path.resolve(path.dirname(ledgerPath), "..");
}

function inferLastSeenAt(status: unknown, updatedAt: string): string | null {
  return status === "running" ? updatedAt : null;
}

function inferEndedAt(status: unknown, updatedAt: string): string | null {
  return status === "completed" || status === "stopped" || status === "failed" || status === "lost"
    ? updatedAt
    : null;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
