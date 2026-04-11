/**
 * @file Unit tests for startup profile policy checks and structured logging.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertStartupProfilePass,
  evaluateStartupProfile,
  logStartupProfileReport
} from "./startup-profile.js";
import type { StartupProfileCheckId, StartupProfileReport } from "./startup-profile.js";

interface TempPaths {
  appStaticDir: string;
  auditLogPath: string;
}

interface LogRecorder {
  infoLines: string[];
  warnLines: string[];
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

async function createTempPaths(): Promise<TempPaths> {
  const base = await mkdtemp(join(tmpdir(), "startup-profile-"));
  const appStaticDir = join(base, "apps", "web");
  const auditDir = join(base, "audit");
  await mkdir(appStaticDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });

  return {
    appStaticDir,
    auditLogPath: join(auditDir, "bridge-audit.jsonl")
  };
}

function getCheck(report: StartupProfileReport, id: StartupProfileCheckId) {
  const check = report.checks.find((entry) => entry.id === id);
  assert.ok(check, `expected startup profile check "${id}"`);
  return check;
}

function getRuntimeBackendCheck(report: StartupProfileReport, backendId: string) {
  const check = report.checks.find(
    (entry) => entry.id === "runtime_backend_signal" && entry.metadata?.backendId === backendId
  );
  assert.ok(check, `expected runtime backend signal check for "${backendId}"`);
  return check;
}

function createLogRecorder(): LogRecorder {
  const infoLines: string[] = [];
  const warnLines: string[] = [];

  return {
    infoLines,
    warnLines,
    logger: {
      info: (...args: unknown[]) => {
        infoLines.push(args.map(String).join(" "));
      },
      warn: (...args: unknown[]) => {
        warnLines.push(args.map(String).join(" "));
      }
    }
  };
}

function parseLogPayload(line: string): Record<string, unknown> {
  const prefix = "[bridge] startup_profile ";
  assert.equal(line.startsWith(prefix), true, `unexpected log line: ${line}`);
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>;
}

test("startup profile passes with healthy runtime/env configuration", async () => {
  const paths = await createTempPaths();
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["tmux"],
      appStaticEnabled: true,
      appStaticDir: paths.appStaticDir,
      auditLogPath: paths.auditLogPath
    },
    runtimeAvailability: [{ backendId: "tmux", available: true }],
    nodeVersion: "22.13.0"
  });

  assert.equal(report.failed, 0);
  assert.equal(getCheck(report, "node_runtime_version").status, "pass");
  assert.equal(getRuntimeBackendCheck(report, "tmux").status, "pass");
  assert.equal(getCheck(report, "app_static_dir_policy").status, "pass");
  assert.equal(getCheck(report, "audit_log_path_policy").status, "pass");
  assert.doesNotThrow(() => assertStartupProfilePass(report));
});

test("startup profile fails when node runtime is below policy minimum", async () => {
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["cmux"],
      appStaticEnabled: false,
      appStaticDir: "apps/web",
      auditLogPath: null
    },
    runtimeAvailability: [{ backendId: "cmux", available: true }],
    nodeVersion: "20.10.0"
  });

  const nodeCheck = getCheck(report, "node_runtime_version");
  assert.equal(nodeCheck.status, "fail");
  assert.match(nodeCheck.detail, /requires major version >= 22/);
  assert.match(nodeCheck.remediation ?? "", /Upgrade Node runtime/);
  assert.throws(() => assertStartupProfilePass(report), /node_runtime_version/);
});

test("startup profile fails when a configured runtime backend signal is unavailable", async () => {
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["tmux", "managed"],
      appStaticEnabled: false,
      appStaticDir: "apps/web",
      auditLogPath: null
    },
    runtimeAvailability: [
      { backendId: "tmux", available: false },
      { backendId: "managed", available: true }
    ],
    nodeVersion: "22.1.0"
  });

  const tmuxCheck = getRuntimeBackendCheck(report, "tmux");
  assert.equal(tmuxCheck.status, "fail");
  assert.match(tmuxCheck.detail, /reported unavailable/);
  assert.match(tmuxCheck.remediation ?? "", /Install\/start tmux/);
  assert.equal(getRuntimeBackendCheck(report, "managed").status, "pass");
  assert.throws(() => assertStartupProfilePass(report), /runtime_backend_signal/);
});

test("startup profile fails when static app directory is missing", async () => {
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["cmux"],
      appStaticEnabled: true,
      appStaticDir: join(tmpdir(), `missing-static-${Date.now()}`),
      auditLogPath: null
    },
    runtimeAvailability: [{ backendId: "cmux", available: true }],
    nodeVersion: "22.0.0"
  });

  const staticCheck = getCheck(report, "app_static_dir_policy");
  assert.equal(staticCheck.status, "fail");
  assert.match(staticCheck.detail, /does not exist/);
  assert.match(staticCheck.remediation ?? "", /COMMANDRELAY_APP_STATIC_DIR/);
  assert.throws(() => assertStartupProfilePass(report), /app_static_dir_policy/);
});

test("startup profile fails when audit log parent directory is missing", async () => {
  const base = await mkdtemp(join(tmpdir(), "startup-profile-audit-missing-"));
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["cmux"],
      appStaticEnabled: false,
      appStaticDir: "apps/web",
      auditLogPath: join(base, "missing-parent", "audit.jsonl")
    },
    runtimeAvailability: [{ backendId: "cmux", available: true }],
    nodeVersion: "22.2.0"
  });

  const auditCheck = getCheck(report, "audit_log_path_policy");
  assert.equal(auditCheck.status, "fail");
  assert.match(auditCheck.detail, /parent directory does not exist/);
  assert.match(auditCheck.remediation ?? "", /COMMANDRELAY_AUDIT_LOG/);
  assert.throws(() => assertStartupProfilePass(report), /audit_log_path_policy/);
});

test("startup profile fails when audit log path points to a directory", async () => {
  const paths = await createTempPaths();
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["cmux"],
      appStaticEnabled: false,
      appStaticDir: paths.appStaticDir,
      auditLogPath: join(paths.auditLogPath, "..")
    },
    runtimeAvailability: [{ backendId: "cmux", available: true }],
    nodeVersion: "22.4.0"
  });

  const auditCheck = getCheck(report, "audit_log_path_policy");
  assert.equal(auditCheck.status, "fail");
  assert.match(auditCheck.detail, /points to a directory/);
  assert.throws(() => assertStartupProfilePass(report), /audit_log_path_policy/);
});

test("structured startup profile logs include summary and per-check events", async () => {
  const report = await evaluateStartupProfile({
    config: {
      runtimeBackends: ["tmux"],
      appStaticEnabled: false,
      appStaticDir: "apps/web",
      auditLogPath: null
    },
    runtimeAvailability: [{ backendId: "tmux", available: false }],
    nodeVersion: "22.7.0"
  });
  const recorder = createLogRecorder();

  logStartupProfileReport(report, recorder.logger);

  assert.ok(recorder.infoLines.length >= 2);
  assert.equal(recorder.warnLines.length, 1);
  const summaryPayload = parseLogPayload(recorder.infoLines[0]);
  assert.equal(summaryPayload.event, "startup_profile_summary");
  assert.equal(summaryPayload.profile, "remote_host");

  const warnPayload = parseLogPayload(recorder.warnLines[0]);
  assert.equal(warnPayload.event, "startup_profile_check");
  assert.equal(warnPayload.id, "runtime_backend_signal");
  assert.equal(warnPayload.status, "fail");
  const metadata = warnPayload.metadata as Record<string, unknown> | undefined;
  assert.equal(metadata?.backendId, "tmux");
});
