/**
 * @file Runs a reconnect/replay soak that simulates flaky transport by repeatedly dropping client sockets.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startBridgeServer } from "../../src/server/bridge-server.js";
import {
  HOST,
  canBindLoopback,
  closeWs,
  createWsProbe,
  isPaneOutput,
  reservePort,
  streamSeq,
  type Envelope
} from "../../src/server/bridge-server.replay.e2e.helpers.js";

interface SoakOptions {
  durationMinutes: number;
  dropMinMs: number;
  dropMaxMs: number;
  pollIntervalMs: number;
  outputPath: string | null;
}

interface SoakSummary {
  startedAtUtc: string;
  endedAtUtc: string;
  durationMinutes: number;
  configuredDurationMinutes: number;
  cycles: number;
  reconnects: number;
  outputEventsSeen: number;
  lastObservedStreamSeq: number;
  replayResumeCount: number;
  replayGapSnapshotFallbackCount: number;
  maxReplayLag: number;
  replayMismatchCount: number;
  pass: boolean;
}

interface CapturedAuditEvent {
  action: string;
  details: Record<string, unknown>;
}

const DEFAULTS: SoakOptions = {
  durationMinutes: 30,
  dropMinMs: 600,
  dropMaxMs: 1_600,
  pollIntervalMs: 80,
  outputPath: null
};

/**
 * Parses CLI options for the flaky network soak runner.
 *
 * @param argv Process argv tokens.
 * @returns Parsed soak options.
 */
function parseOptions(argv: readonly string[]): SoakOptions {
  const options: SoakOptions = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--duration-minutes" && next) {
      options.durationMinutes = parsePositiveNumber(next, "--duration-minutes");
      i += 1;
      continue;
    }
    if (token === "--drop-min-ms" && next) {
      options.dropMinMs = parsePositiveInt(next, "--drop-min-ms");
      i += 1;
      continue;
    }
    if (token === "--drop-max-ms" && next) {
      options.dropMaxMs = parsePositiveInt(next, "--drop-max-ms");
      i += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && next) {
      options.pollIntervalMs = parsePositiveInt(next, "--poll-interval-ms");
      i += 1;
      continue;
    }
    if (token === "--output" && next) {
      options.outputPath = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete option: ${token}`);
  }

  if (options.dropMaxMs < options.dropMinMs) {
    throw new Error("--drop-max-ms must be >= --drop-min-ms");
  }
  return options;
}

/**
 * Parses a positive integer option value.
 *
 * @param raw Raw option value.
 * @param flag Option flag for error details.
 * @returns Positive integer.
 */
function parsePositiveInt(raw: string, flag: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${flag} must be an integer (received: ${raw})`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be > 0 (received: ${raw})`);
  }
  return parsed;
}

/**
 * Parses a positive numeric option value.
 *
 * @param raw Raw option value.
 * @param flag Option flag for error details.
 * @returns Positive number.
 */
function parsePositiveNumber(raw: string, flag: string): number {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be > 0 (received: ${raw})`);
  }
  return parsed;
}

/**
 * Returns a random integer inside a closed interval.
 *
 * @param min Minimum value.
 * @param max Maximum value.
 * @returns Random integer in `[min, max]`.
 */
function randomIntInclusive(min: number, max: number): number {
  if (min === max) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * A deterministic tmux-like adapter that appends one line per capture call.
 */
class SyntheticStreamingTmux {
  private readonly lines: string[] = [];
  private nextLineNumber = 1;

  /**
   * Reports adapter availability.
   *
   * @returns Always true.
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Returns one synthetic pane.
   *
   * @returns Synthetic pane list.
   */
  async listPanes(): Promise<Array<Record<string, unknown>>> {
    return [
      {
        sessionName: "soak",
        windowName: "runner",
        paneId: "%1",
        paneIndex: 0,
        paneCurrentCommand: "bash"
      }
    ];
  }

  /**
   * Accepts input without side effects for this synthetic runtime.
   *
   * @returns Resolves immediately.
   */
  async sendInput(): Promise<void> {
    return;
  }

  /**
   * Appends one line and returns the full pane snapshot.
   *
   * @returns Snapshot text.
   */
  async capturePane(): Promise<string> {
    this.lines.push(`soak-line-${this.nextLineNumber.toString().padStart(5, "0")}`);
    this.nextLineNumber += 1;
    return `${this.lines.join("\n")}\n`;
  }
}

/**
 * Runs the flaky reconnect soak and returns summary metrics.
 *
 * @param options Runner options.
 * @returns Soak summary.
 */
async function runSoak(options: SoakOptions): Promise<SoakSummary> {
  if (!(await canBindLoopback())) {
    throw new Error("loopback bind not permitted in this runtime");
  }

  const startedAt = Date.now();
  const durationMs = Math.round(options.durationMinutes * 60_000);
  const deadline = startedAt + durationMs;
  const port = await reservePort();
  const auditEvents: CapturedAuditEvent[] = [];
  const tmux = new SyntheticStreamingTmux();
  const runtime = await startBridgeServer({
    config: {
      host: HOST,
      port,
      strictProtocolParsing: true,
      pollIntervalMs: options.pollIntervalMs,
      replayLines: 500,
      maxHistoryEvents: 80_000,
      maxInputBytes: 512,
      maxAttachedPanes: 4,
      maxMessagesPerMinute: 12_000,
      maxInputsPerMinute: 12_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      audit: (event: CapturedAuditEvent) => {
        auditEvents.push(event);
      }
    }
  });

  let cycles = 0;
  let reconnectCursor = 0;
  let outputEventsSeen = 0;
  let replayMismatchCount = 0;

  try {
    const anchor = await createWsProbe(`ws://${HOST}:${port}/ws`);
    await anchor.next((message) => message.type === "hello");
    anchor.sendRequest("attach", "anchor-attach", { paneId: "%1" });
    await anchor.next(
      (message) => message.type === "ack" && message.requestId === "anchor-attach"
    );

    while (Date.now() < deadline) {
      cycles += 1;
      const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);

      try {
        await probe.next((message) => message.type === "hello");
        const requestId = `attach-${cycles}`;
        const attachPayload: Record<string, unknown> = { paneId: "%1" };
        if (reconnectCursor > 0) {
          attachPayload.lastSeq = reconnectCursor;
        }
        probe.sendRequest("attach", requestId, attachPayload);

        await probe.next(
          (message) => message.type === "ack" && message.requestId === requestId
        );

        const dropAfterMs = randomIntInclusive(options.dropMinMs, options.dropMaxMs);
        const segmentDeadline = Math.min(Date.now() + dropAfterMs, deadline);
        while (Date.now() < segmentDeadline) {
          const output = await probe.next(
            (message: Envelope) => isPaneOutput(message, "%1"),
            2_000
          );
          const currentSeq = streamSeq(output);
          const mode = typeof output.payload.mode === "string" ? output.payload.mode : null;
          const expectedNext = reconnectCursor + 1;
          if (mode === "snapshot" && currentSeq === reconnectCursor) {
            continue;
          }
          if (currentSeq !== expectedNext) {
            replayMismatchCount += 1;
            reconnectCursor = Math.max(reconnectCursor, currentSeq);
            continue;
          }

          reconnectCursor = currentSeq;
          outputEventsSeen += 1;
        }
      } finally {
        probe.socket.terminate();
        await closeWs(probe.socket);
      }

      await drainProbeOutputs(anchor);
      await sleep(randomIntInclusive(35, 110));
    }

    anchor.socket.terminate();
    await closeWs(anchor.socket);
  } finally {
    await runtime.close();
  }

  const replayResumeEvents = auditEvents.filter((event) => event.action === "replay_resume");
  const replayFallbackEvents = auditEvents.filter(
    (event) => event.action === "replay_gap_snapshot_fallback"
  );

  let maxReplayLag = 0;
  for (const event of replayResumeEvents) {
    const latestSeq = Number(event.details.latestSeq);
    const lastSeq = Number(event.details.lastSeq);
    if (Number.isFinite(latestSeq) && Number.isFinite(lastSeq)) {
      maxReplayLag = Math.max(maxReplayLag, latestSeq - lastSeq);
    }
  }
  for (const event of replayFallbackEvents) {
    const latestSeq = Number(event.details.latestSeq);
    const lastSeq = Number(event.details.lastSeq);
    if (Number.isFinite(latestSeq) && Number.isFinite(lastSeq)) {
      maxReplayLag = Math.max(maxReplayLag, Math.abs(latestSeq - lastSeq));
    }
  }

  const endedAt = Date.now();
  const durationMinutes = (endedAt - startedAt) / 60_000;
  const summary: SoakSummary = {
    startedAtUtc: new Date(startedAt).toISOString(),
    endedAtUtc: new Date(endedAt).toISOString(),
    durationMinutes: Number(durationMinutes.toFixed(3)),
    configuredDurationMinutes: options.durationMinutes,
    cycles,
    reconnects: Math.max(0, cycles - 1),
    outputEventsSeen,
    lastObservedStreamSeq: reconnectCursor,
    replayResumeCount: replayResumeEvents.length,
    replayGapSnapshotFallbackCount: replayFallbackEvents.length,
    maxReplayLag,
    replayMismatchCount,
    pass: replayMismatchCount === 0 && durationMinutes >= options.durationMinutes
  };

  return summary;
}

/**
 * Drains queued output messages from a probe to avoid unbounded queue growth.
 *
 * @param probe Probe whose queue should be drained.
 */
async function drainProbeOutputs(probe: Awaited<ReturnType<typeof createWsProbe>>): Promise<void> {
  while (true) {
    try {
      await probe.next((message) => isPaneOutput(message, "%1"), 25);
    } catch {
      return;
    }
  }
}

/**
 * Entry point for CLI execution.
 */
async function main(): Promise<void> {
  const options = parseOptions(process.argv);
  const summary = await runSoak(options);
  const serialized = JSON.stringify(summary, null, 2);
  console.log(serialized);
  if (options.outputPath) {
    writeFileSync(resolve(options.outputPath), `${serialized}\n`, "utf8");
  }
  if (!summary.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? `run-flaky-network-soak error: ${error.message}` : String(error)
  );
  process.exitCode = 1;
});
