/** @file Polling bridge engine that streams tmux pane output to subscribers. */
export interface BridgePaneEvent {
  mode: "snapshot" | "delta";
  paneId: string;
  chunk: string;
  streamSeq: number;
}

export interface BridgeAttachReplayMetadata {
  paneId: string;
  requestedLastSeq: number | null;
  latestSeq: number;
  oldestHistorySeq: number | null;
  latestHistorySeq: number | null;
  replayedCount: number;
  replayUsed: boolean;
  fallbackToSnapshot: boolean;
  replayGapDetected: boolean;
}

export interface BridgeReplayOffsetSnapshotRow {
  paneId: string;
  replayOffset: number;
}

interface PaneWatcher {
  subscribers: Set<string>;
  lastOutput: string;
  streamSeq: number;
  history: BridgePaneEvent[];
  nextPollAt: number;
  idlePollStreak: number;
  errorPollStreak: number;
  inFlightCapture: Promise<string> | null;
}

interface BridgeEngineDeps {
  tmux: { capturePane: (paneId: string, lines: number) => Promise<string> };
  replayLines: number;
  pollIntervalMs: number;
  maxHistoryEvents?: number;
  maxPollIntervalMs?: number;
  now?: () => number;
  onOutput: (clientId: string, event: BridgePaneEvent) => void;
  onError: (clientId: string, paneId: string, error: unknown) => void;
}

const MAX_IDLE_POLL_BACKOFF_MULTIPLIER = 8;
const MAX_ERROR_POLL_BACKOFF_MULTIPLIER = 16;

/** Streaming engine that polls tmux panes and computes output diffs. */
export class BridgeEngine {
  private readonly tmux: BridgeEngineDeps["tmux"];
  private readonly replayLines: number;
  private readonly pollIntervalMs: number;
  private readonly maxHistoryEvents: number;
  private readonly now: () => number;
  private readonly maxPollDelayMs: number;
  private readonly maxErrorPollDelayMs: number;
  private readonly onOutput: BridgeEngineDeps["onOutput"];
  private readonly onError: BridgeEngineDeps["onError"];
  private readonly panes: Map<string, PaneWatcher>;
  private pollTimer: NodeJS.Timeout | null;
  private isPolling: boolean;
  private isShuttingDown: boolean;

  /**
   * @param deps Engine dependencies.
   */
  constructor(deps: BridgeEngineDeps) {
    this.tmux = deps.tmux;
    this.replayLines = deps.replayLines;
    this.pollIntervalMs = deps.pollIntervalMs;
    this.maxHistoryEvents = deps.maxHistoryEvents ?? 300;
    this.now = deps.now ?? (() => Date.now());
    this.maxPollDelayMs =
      deps.maxPollIntervalMs ?? this.pollIntervalMs * MAX_IDLE_POLL_BACKOFF_MULTIPLIER;
    this.maxErrorPollDelayMs = Math.max(
      this.maxPollDelayMs,
      this.pollIntervalMs * MAX_ERROR_POLL_BACKOFF_MULTIPLIER
    );
    this.onOutput = deps.onOutput;
    this.onError = deps.onError;
    this.panes = new Map<string, PaneWatcher>();
    this.pollTimer = null;
    this.isPolling = false;
    this.isShuttingDown = false;
  }

  /**
   * Starts polling when at least one pane has subscribers.
   */
  ensureStarted(): void {
    if (this.isShuttingDown || this.pollTimer) return;
    this.scheduleNextPollIfNeeded();
  }

  /**
   * Stops polling when no pane is actively subscribed.
   */
  stopIfIdle(): void {
    if (this.panes.size > 0 || !this.pollTimer) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * Shuts down polling and releases all pane watchers.
   */
  close(): void {
    this.isShuttingDown = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
    this.panes.clear();
  }

  /**
   * Returns runtime stats for health endpoints.
   */
  getStats(): { watchedPanes: number; polling: boolean } {
    return {
      watchedPanes: this.panes.size,
      polling: Boolean(this.pollTimer)
    };
  }

  /**
   * Returns host-authoritative replay offsets for watched panes.
   *
   * @returns Replay offsets keyed by pane id.
   */
  getReplayOffsetsSnapshot(): BridgeReplayOffsetSnapshotRow[] {
    return Array.from(this.panes.entries())
      .map(([paneId, watcher]) => ({
        paneId,
        replayOffset: watcher.streamSeq
      }))
      .sort((a, b) => a.paneId.localeCompare(b.paneId));
  }

  /**
   * Attaches a client to a pane and pushes replay/snapshot state.
   */
  async attach(
    clientId: string,
    paneId: string,
    sinceSeq: number | null = null
  ): Promise<BridgeAttachReplayMetadata> {
    if (this.isShuttingDown) {
      throw new Error("bridge engine is shutting down");
    }

    let watcher = this.panes.get(paneId);
    if (!watcher) {
      watcher = this.createWatcher();
      this.panes.set(paneId, watcher);
    }

    watcher.subscribers.add(clientId);
    const requestedLastSeq = Number.isInteger(sinceSeq) ? Number(sinceSeq) : null;

    try {
      if (watcher.streamSeq > 0 && requestedLastSeq !== null) {
        const historyBySeq = [...watcher.history].sort((a, b) => a.streamSeq - b.streamSeq);
        const oldestHistorySeq = historyBySeq.at(0)?.streamSeq ?? null;
        const latestHistorySeq = historyBySeq.at(-1)?.streamSeq ?? null;
        const replayed = historyBySeq.filter((event) => event.streamSeq > requestedLastSeq);
        const replayGapDetected =
          replayed.length > 0
            ? replayed[0].streamSeq !== requestedLastSeq + 1
            : requestedLastSeq < watcher.streamSeq;

        if (replayed.length > 0 && !replayGapDetected) {
          for (const event of replayed) {
            this.onOutput(clientId, event);
          }
          this.scheduleWatcherAfterAttach(watcher);
          this.ensureStarted();
          return {
            paneId,
            requestedLastSeq,
            latestSeq: watcher.streamSeq,
            oldestHistorySeq,
            latestHistorySeq,
            replayedCount: replayed.length,
            replayUsed: true,
            fallbackToSnapshot: false,
            replayGapDetected: false
          };
        }

        this.onOutput(clientId, {
          mode: "snapshot",
          paneId,
          chunk: watcher.lastOutput,
          streamSeq: watcher.streamSeq
        });
        this.scheduleWatcherAfterAttach(watcher);
        this.ensureStarted();
        return {
          paneId,
          requestedLastSeq,
          latestSeq: watcher.streamSeq,
          oldestHistorySeq,
          latestHistorySeq,
          replayedCount: 0,
          replayUsed: false,
          fallbackToSnapshot: true,
          replayGapDetected
        };
      }

      if (watcher.streamSeq > 0) {
        this.onOutput(clientId, {
          mode: "snapshot",
          paneId,
          chunk: watcher.lastOutput,
          streamSeq: watcher.streamSeq
        });
        this.scheduleWatcherAfterAttach(watcher);
        this.ensureStarted();
        const historyBySeq = [...watcher.history].sort((a, b) => a.streamSeq - b.streamSeq);
        return {
          paneId,
          requestedLastSeq,
          latestSeq: watcher.streamSeq,
          oldestHistorySeq: historyBySeq.at(0)?.streamSeq ?? null,
          latestHistorySeq: historyBySeq.at(-1)?.streamSeq ?? null,
          replayedCount: 0,
          replayUsed: false,
          fallbackToSnapshot: false,
          replayGapDetected: false
        };
      }

      const snapshot = await this.capturePaneOutput(watcher, paneId);
      let latestSeq = watcher.streamSeq;
      if (watcher.streamSeq === 0) {
        watcher.lastOutput = snapshot;
        const event = this.nextEvent(watcher, paneId, "snapshot", snapshot);
        latestSeq = event.streamSeq;
        this.onOutput(clientId, event);
      } else {
        this.onOutput(clientId, {
          mode: "snapshot",
          paneId,
          chunk: watcher.lastOutput,
          streamSeq: watcher.streamSeq
        });
      }

      this.resetWatcherBackoff(watcher, this.now());
      const historyBySeq = [...watcher.history].sort((a, b) => a.streamSeq - b.streamSeq);
      this.ensureStarted();
      return {
        paneId,
        requestedLastSeq,
        latestSeq,
        oldestHistorySeq: historyBySeq.at(0)?.streamSeq ?? null,
        latestHistorySeq: historyBySeq.at(-1)?.streamSeq ?? null,
        replayedCount: 0,
        replayUsed: false,
        fallbackToSnapshot: false,
        replayGapDetected: false
      };
    } catch (error) {
      watcher.subscribers.delete(clientId);
      if (watcher.subscribers.size === 0) {
        this.panes.delete(paneId);
      }
      this.stopIfIdle();
      throw error;
    }
  }

  /**
   * Detaches a client from one pane.
   */
  detach(clientId: string, paneId: string): void {
    const watcher = this.panes.get(paneId);
    if (!watcher) return;
    watcher.subscribers.delete(clientId);
    if (watcher.subscribers.size === 0) {
      this.panes.delete(paneId);
    }
    this.stopIfIdle();
  }

  /**
   * Detaches a client from all panes.
   */
  detachAll(clientId: string): void {
    if (this.isShuttingDown) return;
    for (const [paneId] of this.panes) {
      this.detach(clientId, paneId);
    }
  }

  /**
   * Polls due panes for incremental output.
   */
  async pollOnce(force = true, reschedule = false): Promise<void> {
    if (this.isShuttingDown || this.isPolling || this.panes.size === 0) return;
    this.isPolling = true;

    try {
      const entries = Array.from(this.panes.entries());
      for (const [paneId, watcher] of entries) {
        if (!force && this.now() < watcher.nextPollAt) {
          continue;
        }

        try {
          const output = await this.capturePaneOutput(watcher, paneId);
          const completedAtMs = this.now();
          const delta = computeDelta(watcher.lastOutput, output);
          if (!delta) {
            this.applyIdleBackoff(watcher, completedAtMs);
            continue;
          }

          watcher.lastOutput = output;
          const event = this.nextEvent(watcher, paneId, delta.mode, delta.chunk);
          this.resetWatcherBackoff(watcher, completedAtMs);

          for (const clientId of watcher.subscribers) {
            this.onOutput(clientId, event);
          }
        } catch (error) {
          this.applyErrorBackoff(watcher, this.now());
          for (const clientId of watcher.subscribers) {
            this.onError(clientId, paneId, error);
          }
        }
      }
    } finally {
      this.isPolling = false;
      if (reschedule && !this.isShuttingDown && this.panes.size > 0) {
        this.scheduleNextPollIfNeeded();
      }
    }
  }

  /**
   * Schedules the next poll tick based on the earliest pane deadline.
   */
  private scheduleNextPollIfNeeded(): void {
    if (this.isShuttingDown) return;
    if (this.panes.size === 0) return;

    const delayMs = this.computeNextPollDelayMs();
    if (delayMs <= 0) {
      if (this.pollTimer) return;
      void this.pollOnce(false);
      return;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce(false, true);
    }, delayMs);
  }

  /**
   * Computes delay to the next pane capture deadline.
   */
  private computeNextPollDelayMs(): number {
    const nowMs = this.now();
    let nextMs = Number.POSITIVE_INFINITY;
    for (const watcher of this.panes.values()) {
      if (watcher.nextPollAt < nextMs) {
        nextMs = watcher.nextPollAt;
      }
    }
    if (nextMs === Number.POSITIVE_INFINITY) {
      return this.pollIntervalMs;
    }
    return Math.max(0, Math.min(this.maxPollDelayMs, nextMs - nowMs));
  }

  /**
   * Produces a sequenced pane event and stores it in bounded history.
   */
  private nextEvent(
    watcher: PaneWatcher,
    paneId: string,
    mode: "snapshot" | "delta",
    chunk: string
  ): BridgePaneEvent {
    watcher.streamSeq += 1;
    const event: BridgePaneEvent = {
      mode,
      paneId,
      chunk,
      streamSeq: watcher.streamSeq
    };

    watcher.history.push(event);
    if (watcher.history.length > this.maxHistoryEvents) {
      watcher.history.shift();
    }

    return event;
  }

  /**
   * Creates a watcher with polling disabled until the first attach snapshot lands.
   */
  private createWatcher(): PaneWatcher {
    return {
      subscribers: new Set<string>(),
      lastOutput: "",
      streamSeq: 0,
      history: [],
      nextPollAt: Number.POSITIVE_INFINITY,
      idlePollStreak: 0,
      errorPollStreak: 0,
      inFlightCapture: null
    };
  }

  /**
   * Shares one capture operation per pane so attach and poll do not duplicate work.
   */
  private async capturePaneOutput(watcher: PaneWatcher, paneId: string): Promise<string> {
    if (watcher.inFlightCapture) {
      return watcher.inFlightCapture;
    }

    const capture = this.tmux.capturePane(paneId, this.replayLines);
    const inFlightCapture = capture.finally(() => {
      if (watcher.inFlightCapture === inFlightCapture) {
        watcher.inFlightCapture = null;
      }
    });
    watcher.inFlightCapture = inFlightCapture;
    return inFlightCapture;
  }

  /**
   * Pulls the next poll forward after a new attach so stale snapshots refresh quickly.
   */
  private scheduleWatcherAfterAttach(watcher: PaneWatcher): void {
    const nextPollAt = this.now() + this.pollIntervalMs;
    watcher.nextPollAt = Math.min(watcher.nextPollAt, nextPollAt);
  }

  /**
   * Resets polling cadence when a pane produces fresh output.
   */
  private resetWatcherBackoff(watcher: PaneWatcher, completedAtMs: number): void {
    watcher.idlePollStreak = 0;
    watcher.errorPollStreak = 0;
    watcher.nextPollAt = completedAtMs + this.pollIntervalMs;
  }

  /**
   * Backs off idle panes exponentially so stable panes stop hammering tmux.
   */
  private applyIdleBackoff(watcher: PaneWatcher, completedAtMs: number): void {
    watcher.idlePollStreak += 1;
    watcher.errorPollStreak = 0;
    watcher.nextPollAt =
      completedAtMs +
      computeBackoffDelay(this.pollIntervalMs, watcher.idlePollStreak, this.maxPollDelayMs);
  }

  /**
   * Slows repeated failures harder than idle panes so broken runtimes stop thrashing.
   */
  private applyErrorBackoff(watcher: PaneWatcher, completedAtMs: number): void {
    watcher.errorPollStreak += 1;
    watcher.idlePollStreak = 0;
    watcher.nextPollAt =
      completedAtMs +
      computeBackoffDelay(this.pollIntervalMs, watcher.errorPollStreak, this.maxErrorPollDelayMs);
  }
}

/**
 * Computes a snapshot/delta payload from previous and current pane output.
 */
function computeDelta(
  previous: string,
  current: string
): { mode: "snapshot" | "delta"; chunk: string } | null {
  if (current === previous) return null;
  if (current.startsWith(previous)) {
    const chunk = current.slice(previous.length);
    if (!chunk) return null;
    return { mode: "delta", chunk };
  }
  return { mode: "snapshot", chunk: current };
}

/**
 * Computes an exponentially increasing delay bounded by a safe maximum.
 */
function computeBackoffDelay(baseMs: number, streak: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseMs * (2 ** streak));
}
