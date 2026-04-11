/**
 * @file Layered bridge status derivation from telemetry counters and latencies.
 */

/**
 * Layer severity for bridge status snapshots.
 */
export type BridgeStatusSeverity = "ok" | "warn" | "fail";

/**
 * One issue emitted by a layer evaluator.
 */
export interface BridgeStatusIssue {
  layer: keyof BridgeStatusSnapshot["layers"];
  severity: BridgeStatusSeverity;
  code: string;
  message: string;
}

/**
 * Per-layer status payload.
 */
export interface BridgeStatusLayerSnapshot {
  severity: BridgeStatusSeverity;
  metrics: Record<string, number | null>;
}

/**
 * Multi-layer bridge status snapshot derived from telemetry counters/latencies.
 */
export interface BridgeStatusSnapshot {
  schema: "bridge.status.v1";
  generatedAt: number;
  overall: BridgeStatusSeverity;
  layers: {
    transport: BridgeStatusLayerSnapshot;
    runtime: BridgeStatusLayerSnapshot;
    replay: BridgeStatusLayerSnapshot;
    safety: BridgeStatusLayerSnapshot;
    observability: BridgeStatusLayerSnapshot;
  };
  issues: BridgeStatusIssue[];
}

/**
 * Aggregated counters consumed by layered status derivation.
 */
export interface BridgeStatusCountersSnapshot {
  connectionsOpened: number;
  connectionsClosed: number;
  listRequests: number;
  attachRequests: number;
  reconnectAttaches: number;
  inputAcks: number;
  streamLagSamples: number;
}

/**
 * Latency snapshot shape consumed by layered status derivation.
 */
export interface BridgeStatusLatencySnapshot {
  p95Ms: number | null;
}

/**
 * Latency map consumed by layered status derivation.
 */
export interface BridgeStatusLatenciesSnapshot {
  connect: BridgeStatusLatencySnapshot;
  reconnect: BridgeStatusLatencySnapshot;
  list: BridgeStatusLatencySnapshot;
  attach: BridgeStatusLatencySnapshot;
  inputAck: BridgeStatusLatencySnapshot;
  streamLag: BridgeStatusLatencySnapshot;
}

/**
 * Input payload for layered bridge status derivation.
 */
export interface BuildBridgeStatusSnapshotInput {
  activeClients: number;
  windowSize: number;
  counters: BridgeStatusCountersSnapshot;
  latenciesMs: BridgeStatusLatenciesSnapshot;
  nowMs?: number;
}

/**
 * Builds a layered bridge status snapshot from aggregate counters and latency windows.
 *
 * @param input Status derivation inputs.
 * @returns Derived layered status payload.
 */
export function buildBridgeStatusSnapshot(input: BuildBridgeStatusSnapshotInput): BridgeStatusSnapshot {
  const { activeClients, windowSize, counters, latenciesMs } = input;
  const issues: BridgeStatusIssue[] = [];
  const transportSeverity = deriveLatencySeverity(
    latenciesMs.connect.p95Ms,
    500,
    1_000,
    "transport",
    "connect_latency_p95",
    issues
  );
  const replaySeverity = deriveLatencySeverity(
    latenciesMs.streamLag.p95Ms,
    200,
    500,
    "replay",
    "stream_lag_p95",
    issues
  );
  const safetySeverity = deriveLatencySeverity(
    latenciesMs.inputAck.p95Ms,
    250,
    500,
    "safety",
    "input_ack_latency_p95",
    issues
  );

  const runtimeSeverity: BridgeStatusSeverity =
    activeClients > 0 && counters.attachRequests === 0 ? "warn" : "ok";
  if (runtimeSeverity === "warn") {
    issues.push({
      layer: "runtime",
      severity: "warn",
      code: "active_clients_without_attach",
      message: "active clients observed with no attach requests in current telemetry window"
    });
  }

  const observabilitySeverity: BridgeStatusSeverity =
    counters.streamLagSamples === 0 && activeClients > 0 ? "warn" : "ok";
  if (observabilitySeverity === "warn") {
    issues.push({
      layer: "observability",
      severity: "warn",
      code: "missing_stream_lag_samples",
      message: "stream lag samples are missing while clients are connected"
    });
  }

  const layers: BridgeStatusSnapshot["layers"] = {
    transport: {
      severity: transportSeverity,
      metrics: {
        activeClients,
        connectP95Ms: latenciesMs.connect.p95Ms,
        reconnectP95Ms: latenciesMs.reconnect.p95Ms,
        connectionsOpened: counters.connectionsOpened,
        connectionsClosed: counters.connectionsClosed
      }
    },
    runtime: {
      severity: runtimeSeverity,
      metrics: {
        activeClients,
        attachRequests: counters.attachRequests,
        listRequests: counters.listRequests
      }
    },
    replay: {
      severity: replaySeverity,
      metrics: {
        reconnectAttaches: counters.reconnectAttaches,
        streamLagP95Ms: latenciesMs.streamLag.p95Ms,
        streamLagSamples: counters.streamLagSamples
      }
    },
    safety: {
      severity: safetySeverity,
      metrics: {
        inputAcks: counters.inputAcks,
        inputAckP95Ms: latenciesMs.inputAck.p95Ms
      }
    },
    observability: {
      severity: observabilitySeverity,
      metrics: {
        telemetrySchemaVersion: 1,
        streamLagSamples: counters.streamLagSamples,
        windowSize
      }
    }
  };

  const overall = maxSeverity([
    layers.transport.severity,
    layers.runtime.severity,
    layers.replay.severity,
    layers.safety.severity,
    layers.observability.severity
  ]);

  return {
    schema: "bridge.status.v1",
    generatedAt: input.nowMs ?? Date.now(),
    overall,
    layers,
    issues
  };
}

/**
 * Applies warn/fail thresholds to a p95 latency metric and emits issues.
 *
 * @param p95Ms Latency p95 sample.
 * @param warnAt Warn threshold.
 * @param failAt Fail threshold.
 * @param layer Layer name.
 * @param code Issue code.
 * @param issues Output issue sink.
 * @returns Derived severity.
 */
function deriveLatencySeverity(
  p95Ms: number | null,
  warnAt: number,
  failAt: number,
  layer: BridgeStatusIssue["layer"],
  code: string,
  issues: BridgeStatusIssue[]
): BridgeStatusSeverity {
  if (p95Ms === null) {
    return "ok";
  }
  if (p95Ms > failAt) {
    issues.push({
      layer,
      severity: "fail",
      code,
      message: `${code} exceeded fail threshold (${p95Ms}ms)`
    });
    return "fail";
  }
  if (p95Ms > warnAt) {
    issues.push({
      layer,
      severity: "warn",
      code,
      message: `${code} exceeded warn threshold (${p95Ms}ms)`
    });
    return "warn";
  }
  return "ok";
}

/**
 * Returns maximum severity across status layers.
 *
 * @param severities Layer severities.
 * @returns Highest severity.
 */
function maxSeverity(severities: readonly BridgeStatusSeverity[]): BridgeStatusSeverity {
  if (severities.includes("fail")) return "fail";
  if (severities.includes("warn")) return "warn";
  return "ok";
}
