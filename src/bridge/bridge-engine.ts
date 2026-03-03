/**
 * @file Polling bridge engine that streams tmux pane output to subscribers.
 */

export interface BridgePaneEvent {
  mode: "snapshot" | "delta";
  paneId: string;
  chunk: string;
  streamSeq: number;
}

/**
 * Metadata describing how attach replay resolution was handled.
 */
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

/**
 * Snapshot row describing host replay offset for a watched pane.
 */
export interface BridgeReplayOffsetSnapshotRow {
  paneId: string;
  replayOffset: number;
}

interface PaneWatcher {
  subscribers: Set<string>;
  lastOutput: string;
  streamSeq: number;
  history: BridgePaneEvent[];
}

interface BridgeEngineDeps {
  tmux: { capturePane: (paneId: string, lines: number) => Promise<string> };
  replayLines: number;
  pollIntervalMs: number;
  maxHistoryEvents?: number;
  onOutput: (clientId: string, event: BridgePaneEvent) => void;
  onError: (clientId: string, paneId: string, error: unknown) => void;
}

/**
 * Streaming engine that polls tmux panes and computes output diffs.
 */
export class BridgeEngine {
  private readonly tmux: BridgeEngineDeps["tmux"];
  private readonly replayLines: number;
  private readonly pollIntervalMs: number;
  private readonly maxHistoryEvents: number;
  private readonly onOutput: BridgeEngineDeps["onOutput"];
  private readonly onError: BridgeEngineDeps["onError"];
  private readonly panes: Map<string, PaneWatcher>;
  private pollTimer: NodeJS.Timeout | null;
  private isPolling: boolean;

  /**
   * @param deps Engine dependencies.
   */
  constructor(deps: BridgeEngineDeps) {
    this.tmux = deps.tmux;
    this.replayLines = deps.replayLines;
    this.pollIntervalMs = deps.pollIntervalMs;
    this.maxHistoryEvents = deps.maxHistoryEvents ?? 300;
    this.onOutput = deps.onOutput;
    this.onError = deps.onError;
    this.panes = new Map<string, PaneWatcher>();
    this.pollTimer = null;
    this.isPolling = false;
  }

  /**
   * Starts polling when at least one pane has subscribers.
   */
  ensureStarted(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  /**
   * Stops polling when no pane is actively subscribed.
   */
  stopIfIdle(): void {
    if (this.panes.size > 0 || !this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
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
    let watcher = this.panes.get(paneId);
    if (!watcher) {
      watcher = {
        subscribers: new Set<string>(),
        lastOutput: "",
        streamSeq: 0,
        history: []
      };
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

      const snapshot = await this.tmux.capturePane(paneId, this.replayLines);
      watcher.lastOutput = snapshot;
      const event = this.nextEvent(watcher, paneId, "snapshot", snapshot);
      this.onOutput(clientId, event);
      const historyBySeq = [...watcher.history].sort((a, b) => a.streamSeq - b.streamSeq);
      this.ensureStarted();
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
    } catch (error) {
      watcher.subscribers.delete(clientId);
      if (watcher.subscribers.size === 0 && watcher.streamSeq === 0) {
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
    for (const [paneId] of this.panes) {
      this.detach(clientId, paneId);
    }
  }

  /**
   * Polls all active panes for incremental output.
   */
  async pollOnce(): Promise<void> {
    if (this.isPolling || this.panes.size === 0) return;
    this.isPolling = true;

    const entries = Array.from(this.panes.entries());
    for (const [paneId, watcher] of entries) {
      try {
        const output = await this.tmux.capturePane(paneId, this.replayLines);
        const delta = computeDelta(watcher.lastOutput, output);
        if (!delta) continue;

        watcher.lastOutput = output;
        const event = this.nextEvent(watcher, paneId, delta.mode, delta.chunk);

        for (const clientId of watcher.subscribers) {
          this.onOutput(clientId, event);
        }
      } catch (error) {
        for (const clientId of watcher.subscribers) {
          this.onError(clientId, paneId, error);
        }
      }
    }

    this.isPolling = false;
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
