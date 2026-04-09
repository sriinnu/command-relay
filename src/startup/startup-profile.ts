/**
 * @file Startup profile checks for remote-host runtime policy and environment sanity.
 */

import { access, constants as fsConstants, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import type { BridgeConfig } from "../config.js";
import type { RuntimeBackendAvailability } from "../runtime/runtime-adapter-factory.js";

/**
 * Startup profile name used for structured logging and diagnostics.
 */
export const STARTUP_PROFILE_NAME = "remote_host";

/**
 * Minimum supported Node major version for startup profile policy.
 */
export const STARTUP_PROFILE_MIN_NODE_MAJOR = 22;

/**
 * Supported startup profile check identifiers.
 */
export type StartupProfileCheckId =
  | "node_runtime_version"
  | "runtime_backend_signal"
  | "app_static_dir_policy"
  | "audit_log_path_policy";

/**
 * Status emitted by each startup profile check.
 */
export type StartupProfileCheckStatus = "pass" | "fail" | "skip";

/**
 * One startup profile check result.
 */
export interface StartupProfileCheckResult {
  id: StartupProfileCheckId;
  status: StartupProfileCheckStatus;
  detail: string;
  remediation?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Startup profile evaluation report.
 */
export interface StartupProfileReport {
  profile: string;
  nodeVersion: string;
  checks: StartupProfileCheckResult[];
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Inputs required to evaluate startup profile checks.
 */
export interface StartupProfileContext {
  config: Pick<BridgeConfig, "runtimeBackends" | "appStaticEnabled" | "appStaticDir" | "auditLogPath">;
  runtimeAvailability: RuntimeBackendAvailability[];
  nodeVersion?: string;
}

/**
 * Minimal logger contract used for startup profile structured logs.
 */
export interface StartupProfileLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/**
 * Evaluates startup profile policy checks.
 *
 * @param context Startup policy context.
 * @returns Aggregated startup profile report.
 */
export async function evaluateStartupProfile(context: StartupProfileContext): Promise<StartupProfileReport> {
  const nodeVersion = context.nodeVersion ?? process.versions.node;
  const checks: StartupProfileCheckResult[] = [
    evaluateNodeRuntimeVersionPolicy(nodeVersion),
    ...evaluateRuntimeBackendSignalPolicies(
      context.config.runtimeBackends,
      context.runtimeAvailability
    ),
    await evaluateAppStaticDirPolicy(context.config.appStaticEnabled, context.config.appStaticDir),
    await evaluateAuditLogPathPolicy(context.config.auditLogPath)
  ];

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skip").length;

  return {
    profile: STARTUP_PROFILE_NAME,
    nodeVersion,
    checks,
    passed,
    failed,
    skipped
  };
}

/**
 * Logs structured startup profile summary and per-check events.
 *
 * @param report Startup profile report.
 * @param logger Logger implementation.
 * @returns Nothing.
 */
export function logStartupProfileReport(
  report: StartupProfileReport,
  logger: StartupProfileLogger = console
): void {
  const summaryPayload = {
    event: "startup_profile_summary",
    profile: report.profile,
    nodeVersion: report.nodeVersion,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped
  };
  logger.info(`[bridge] startup_profile ${JSON.stringify(summaryPayload)}`);

  for (const check of report.checks) {
    const checkPayload = {
      event: "startup_profile_check",
      profile: report.profile,
      id: check.id,
      status: check.status,
      detail: check.detail,
      remediation: check.remediation ?? null,
      metadata: check.metadata ?? null
    };
    const line = `[bridge] startup_profile ${JSON.stringify(checkPayload)}`;
    if (check.status === "fail") {
      logger.warn(line);
      continue;
    }
    logger.info(line);
  }
}

/**
 * Throws when startup profile contains failing checks.
 *
 * @param report Startup profile report.
 * @returns Nothing.
 */
export function assertStartupProfilePass(report: StartupProfileReport): void {
  if (report.failed === 0) return;

  const failedChecks = report.checks.filter((check) => check.status === "fail");
  const reasonText = failedChecks
    .map((check) => {
      const remediationText = check.remediation ? ` Remediation: ${check.remediation}` : "";
      return `${check.id}: ${check.detail}.${remediationText}`;
    })
    .join(" ");

  throw new Error(
    `Startup profile "${report.profile}" failed with ${failedChecks.length} check(s). ${reasonText}`
  );
}

function evaluateNodeRuntimeVersionPolicy(nodeVersion: string): StartupProfileCheckResult {
  const nodeMajor = parseNodeMajorVersion(nodeVersion);
  if (nodeMajor === null) {
    return {
      id: "node_runtime_version",
      status: "fail",
      detail: `Unable to parse Node runtime version "${nodeVersion}"`,
      remediation: `Install Node ${STARTUP_PROFILE_MIN_NODE_MAJOR}+ and restart the bridge`,
      metadata: { nodeVersion, requiredMajor: STARTUP_PROFILE_MIN_NODE_MAJOR }
    };
  }
  if (nodeMajor < STARTUP_PROFILE_MIN_NODE_MAJOR) {
    return {
      id: "node_runtime_version",
      status: "fail",
      detail: `Detected Node ${nodeVersion}; requires major version >= ${STARTUP_PROFILE_MIN_NODE_MAJOR}`,
      remediation: `Upgrade Node runtime on the host to ${STARTUP_PROFILE_MIN_NODE_MAJOR}+`,
      metadata: { nodeVersion, nodeMajor, requiredMajor: STARTUP_PROFILE_MIN_NODE_MAJOR }
    };
  }

  return {
    id: "node_runtime_version",
    status: "pass",
    detail: `Node runtime ${nodeVersion} satisfies startup policy`,
    metadata: { nodeVersion, nodeMajor, requiredMajor: STARTUP_PROFILE_MIN_NODE_MAJOR }
  };
}

function evaluateRuntimeBackendSignalPolicies(
  runtimeBackends: BridgeConfig["runtimeBackends"],
  runtimeAvailability: RuntimeBackendAvailability[]
): StartupProfileCheckResult[] {
  if (runtimeBackends.length === 0) {
    return [
      {
        id: "runtime_backend_signal",
        status: "skip",
        detail: "No runtime backends are configured in COMMANDRELAY_RUNTIME_BACKENDS",
        metadata: { configured: false, backendId: null }
      }
    ];
  }

  return runtimeBackends.map((backendId) => evaluateRuntimeBackendSignalPolicy(backendId, runtimeAvailability));
}

function evaluateRuntimeBackendSignalPolicy(
  backendId: BridgeConfig["runtimeBackends"][number],
  runtimeAvailability: RuntimeBackendAvailability[]
): StartupProfileCheckResult {
  const signal = runtimeAvailability.find((backend) => backend.backendId === backendId);
  if (!signal) {
    return {
      id: "runtime_backend_signal",
      status: "fail",
      detail: `${backendId} backend availability signal is missing from startup probe results`,
      remediation: `Ensure ${backendId} is included in runtime startup availability probing`,
      metadata: { configured: true, backendId, signaled: false, available: null }
    };
  }
  if (!signal.available) {
    return {
      id: "runtime_backend_signal",
      status: "fail",
      detail: `${backendId} backend reported unavailable during startup probe`,
      remediation: `Install/start ${backendId} on the host or remove ${backendId} from COMMANDRELAY_RUNTIME_BACKENDS`,
      metadata: { configured: true, backendId, signaled: true, available: false }
    };
  }

  return {
    id: "runtime_backend_signal",
    status: "pass",
    detail: `${backendId} backend availability signal is present and healthy`,
    metadata: { configured: true, backendId, signaled: true, available: true }
  };
}

async function evaluateAppStaticDirPolicy(
  appStaticEnabled: boolean,
  appStaticDir: string
): Promise<StartupProfileCheckResult> {
  const resolvedPath = resolve(appStaticDir);
  if (!appStaticEnabled) {
    return {
      id: "app_static_dir_policy",
      status: "skip",
      detail: "Static app hosting is disabled; app directory policy check skipped",
      metadata: { enabled: false, resolvedPath }
    };
  }

  const pathStats = await safeStat(resolvedPath);
  if (!pathStats) {
    return {
      id: "app_static_dir_policy",
      status: "fail",
      detail: `Static app directory does not exist: ${resolvedPath}`,
      remediation: "Create COMMANDRELAY_APP_STATIC_DIR or disable static hosting",
      metadata: { enabled: true, resolvedPath }
    };
  }
  if (!pathStats.isDirectory()) {
    return {
      id: "app_static_dir_policy",
      status: "fail",
      detail: `Static app path is not a directory: ${resolvedPath}`,
      remediation: "Point COMMANDRELAY_APP_STATIC_DIR to a readable directory",
      metadata: { enabled: true, resolvedPath }
    };
  }

  try {
    await access(resolvedPath, fsConstants.R_OK | fsConstants.X_OK);
  } catch (error) {
    return {
      id: "app_static_dir_policy",
      status: "fail",
      detail: `Static app directory is not readable: ${resolvedPath} (${formatErrorMessage(error)})`,
      remediation: "Grant read/execute permissions for COMMANDRELAY_APP_STATIC_DIR",
      metadata: { enabled: true, resolvedPath }
    };
  }

  return {
    id: "app_static_dir_policy",
    status: "pass",
    detail: "Static app directory policy check passed",
    metadata: { enabled: true, resolvedPath }
  };
}

async function evaluateAuditLogPathPolicy(auditLogPath: string | null): Promise<StartupProfileCheckResult> {
  if (!auditLogPath) {
    return {
      id: "audit_log_path_policy",
      status: "skip",
      detail: "Audit log path is not configured; audit file policy check skipped",
      metadata: { configured: false }
    };
  }

  const resolvedAuditPath = resolve(auditLogPath);
  const parentPath = dirname(resolvedAuditPath);

  const parentStats = await safeStat(parentPath);
  if (!parentStats) {
    return {
      id: "audit_log_path_policy",
      status: "fail",
      detail: `Audit log parent directory does not exist: ${parentPath}`,
      remediation: "Create the parent directory or set COMMANDRELAY_AUDIT_LOG to a valid writable path",
      metadata: { configured: true, resolvedAuditPath, parentPath }
    };
  }
  if (!parentStats.isDirectory()) {
    return {
      id: "audit_log_path_policy",
      status: "fail",
      detail: `Audit log parent path is not a directory: ${parentPath}`,
      remediation: "Set COMMANDRELAY_AUDIT_LOG to a path under a writable directory",
      metadata: { configured: true, resolvedAuditPath, parentPath }
    };
  }

  const auditPathStats = await safeStat(resolvedAuditPath);
  if (auditPathStats?.isDirectory()) {
    return {
      id: "audit_log_path_policy",
      status: "fail",
      detail: `Audit log path points to a directory: ${resolvedAuditPath}`,
      remediation: "Set COMMANDRELAY_AUDIT_LOG to a file path, not a directory",
      metadata: { configured: true, resolvedAuditPath, parentPath }
    };
  }

  try {
    await access(parentPath, fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    return {
      id: "audit_log_path_policy",
      status: "fail",
      detail: `Audit log parent directory is not writable: ${parentPath} (${formatErrorMessage(error)})`,
      remediation: "Grant write permissions to the audit log parent directory",
      metadata: { configured: true, resolvedAuditPath, parentPath }
    };
  }

  if (auditPathStats) {
    try {
      await access(resolvedAuditPath, fsConstants.W_OK);
    } catch (error) {
      return {
        id: "audit_log_path_policy",
        status: "fail",
        detail: `Audit log file is not writable: ${resolvedAuditPath} (${formatErrorMessage(error)})`,
        remediation: "Grant write permissions to the audit log file or choose another path",
        metadata: { configured: true, resolvedAuditPath, parentPath }
      };
    }
  }

  return {
    id: "audit_log_path_policy",
    status: "pass",
    detail: "Audit log path policy check passed",
    metadata: { configured: true, resolvedAuditPath, parentPath }
  };
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function parseNodeMajorVersion(version: string): number | null {
  const match = version.trim().match(/^v?(\d+)(?:\.\d+)?(?:\.\d+)?/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  return (error as NodeJS.ErrnoException).code === code;
}
