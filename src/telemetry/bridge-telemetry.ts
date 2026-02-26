/**
 * @file Safe in-process telemetry collector for bridge server health snapshots.
 */

const DEFAULT_WINDOW_SIZE = 256;

/**
 * Aggregated latency stats published in health snapshots.
 */
export interface LatencyMetricSnapshot {
  count: number;
  lastMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

/**
 * Public health-safe telemetry payload schema.
 */
export interface BridgeTelemetrySnapshot {
  schema: "bridge.telemetry.v1";
  generatedAt: number;
  activeClients: number;
  windowSize: number;
  counters: {
    connectionsOpened: number;
    connectionsClosed: number;
    listRequests: number;
    attachRequests: number;
    reconnectAttaches: number;
    inputAcks: number;
    streamLagSamples: number;
  };
  latenciesMs: {
    connect: LatencyMetricSnapshot;
    reconnect: LatencyMetricSnapshot;
    list: LatencyMetricSnapshot;
    attach: LatencyMetricSnapshot;
    inputAck: LatencyMetricSnapshot;
    streamLag: LatencyMetricSnapshot;
  };
}

interface LatencyWindow {
  values: number[];
  size: number;
  writeIndex: number;
  totalCount: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

/**
 * Collects bounded latency and counter metrics for bridge runtime operations.
 */
export class BridgeTelemetryCollector {
  private readonly windowSize: number;
  private connectionsOpened = 0;
  private connectionsClosed = 0;
  private listRequests = 0;
  private attachRequests = 0;
  private reconnectAttaches = 0;
  private inputAcks = 0;
  private streamLagSamples = 0;
  private readonly connect: LatencyWindow;
  private readonly reconnect: LatencyWindow;
  private readonly list: LatencyWindow;
  private readonly attach: LatencyWindow;
  private readonly inputAck: LatencyWindow;
  private readonly streamLag: LatencyWindow;

  /**
   * @param windowSize Number of recent samples stored for percentile snapshots.
   */
  constructor(windowSize: number = DEFAULT_WINDOW_SIZE) {
    this.windowSize = Number.isInteger(windowSize) && windowSize > 0 ? windowSize : DEFAULT_WINDOW_SIZE;
    this.connect = createLatencyWindow(this.windowSize);
    this.reconnect = createLatencyWindow(this.windowSize);
    this.list = createLatencyWindow(this.windowSize);
    this.attach = createLatencyWindow(this.windowSize);
    this.inputAck = createLatencyWindow(this.windowSize);
    this.streamLag = createLatencyWindow(this.windowSize);
  }

  /**
   * Records websocket connect handshake latency.
   *
   * @param latencyMs Connect latency in milliseconds.
   */
  recordConnectLatency(latencyMs: number): void {
    this.connectionsOpened += 1;
    recordLatency(this.connect, latencyMs);
  }

  /**
   * Records websocket connection close count.
   */
  recordConnectionClosed(): void {
    this.connectionsClosed += 1;
  }

  /**
   * Records list sessions response latency.
   *
   * @param latencyMs List response latency in milliseconds.
   */
  recordListLatency(latencyMs: number): void {
    this.listRequests += 1;
    recordLatency(this.list, latencyMs);
  }

  /**
   * Records attach acknowledgement latency.
   *
   * @param latencyMs Attach response latency in milliseconds.
   */
  recordAttachLatency(latencyMs: number): void {
    this.attachRequests += 1;
    recordLatency(this.attach, latencyMs);
  }

  /**
   * Records reconnect attach acknowledgement latency.
   *
   * @param latencyMs Reconnect response latency in milliseconds.
   */
  recordReconnectLatency(latencyMs: number): void {
    this.reconnectAttaches += 1;
    recordLatency(this.reconnect, latencyMs);
  }

  /**
   * Records successful input acknowledgement latency.
   *
   * @param latencyMs Input ack latency in milliseconds.
   */
  recordInputAckLatency(latencyMs: number): void {
    this.inputAcks += 1;
    recordLatency(this.inputAck, latencyMs);
  }

  /**
   * Records stream lag (time to first output event after attach).
   *
   * @param latencyMs Stream lag latency in milliseconds.
   */
  recordStreamLag(latencyMs: number): void {
    this.streamLagSamples += 1;
    recordLatency(this.streamLag, latencyMs);
  }

  /**
   * Returns a health-safe aggregate telemetry snapshot.
   *
   * @param activeClients Current active websocket clients.
   * @returns Redacted aggregate telemetry payload.
   */
  getSafeSnapshot(activeClients: number): BridgeTelemetrySnapshot {
    return {
      schema: "bridge.telemetry.v1",
      generatedAt: Date.now(),
      activeClients,
      windowSize: this.windowSize,
      counters: {
        connectionsOpened: this.connectionsOpened,
        connectionsClosed: this.connectionsClosed,
        listRequests: this.listRequests,
        attachRequests: this.attachRequests,
        reconnectAttaches: this.reconnectAttaches,
        inputAcks: this.inputAcks,
        streamLagSamples: this.streamLagSamples
      },
      latenciesMs: {
        connect: snapshotLatency(this.connect),
        reconnect: snapshotLatency(this.reconnect),
        list: snapshotLatency(this.list),
        attach: snapshotLatency(this.attach),
        inputAck: snapshotLatency(this.inputAck),
        streamLag: snapshotLatency(this.streamLag)
      }
    };
  }

}

/**
 * Creates a new bounded latency window accumulator.
 *
 * @param size Ring buffer capacity.
 * @returns Initialized latency window.
 */
function createLatencyWindow(size: number): LatencyWindow {
  return {
    values: new Array<number>(size).fill(0),
    size: 0,
    writeIndex: 0,
    totalCount: 0,
    totalMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: 0,
    lastMs: 0
  };
}

/**
 * Stores one sanitized latency sample in the accumulator.
 *
 * @param window Mutable latency window.
 * @param latencyMs Sample latency in milliseconds.
 */
function recordLatency(window: LatencyWindow, latencyMs: number): void {
  const value = sanitizeLatency(latencyMs);
  window.values[window.writeIndex] = value;
  window.writeIndex = (window.writeIndex + 1) % window.values.length;
  window.size = Math.min(window.size + 1, window.values.length);
  window.totalCount += 1;
  window.totalMs += value;
  window.lastMs = value;
  window.minMs = Math.min(window.minMs, value);
  window.maxMs = Math.max(window.maxMs, value);
}

/**
 * Builds a stable latency snapshot from a bounded window.
 *
 * @param window Latency accumulator.
 * @returns Latency aggregate snapshot.
 */
function snapshotLatency(window: LatencyWindow): LatencyMetricSnapshot {
  if (window.totalCount === 0) {
    return {
      count: 0,
      lastMs: null,
      minMs: null,
      maxMs: null,
      avgMs: null,
      p50Ms: null,
      p95Ms: null
    };
  }

  const recent = window.values.slice(0, window.size).sort((a, b) => a - b);
  return {
    count: window.totalCount,
    lastMs: roundMetric(window.lastMs),
    minMs: roundMetric(window.minMs),
    maxMs: roundMetric(window.maxMs),
    avgMs: roundMetric(window.totalMs / window.totalCount),
    p50Ms: percentile(recent, 0.5),
    p95Ms: percentile(recent, 0.95)
  };
}

/**
 * Normalizes a latency value to a finite non-negative number.
 *
 * @param latencyMs Raw latency value.
 * @returns Normalized latency.
 */
function sanitizeLatency(latencyMs: number): number {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    return 0;
  }
  return latencyMs;
}

/**
 * Computes a nearest-rank percentile in milliseconds.
 *
 * @param sortedValues Sorted ascending latency values.
 * @param ratio Percentile ratio in [0, 1].
 * @returns Rounded percentile value or null.
 */
function percentile(sortedValues: number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1));
  return roundMetric(sortedValues[index]);
}

/**
 * Rounds metrics to two decimals for stable JSON output.
 *
 * @param value Numeric metric value.
 * @returns Rounded metric.
 */
function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
