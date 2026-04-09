# Observability Metrics + Evidence Pack Contract

Last updated: 2026-02-27
Scope: Track A (SSH-first runtime) observability baseline and weekly checkpoint evidence minimum.

## Metrics Contract v1

### Log/Event Envelope Required For Metric Extraction

Use one normalized envelope for lifecycle and policy events used by weekly metrics rollups.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ts` | RFC3339 timestamp | yes | UTC event timestamp. |
| `event` | string | yes | Canonical event name (`connect_start`, `connect_ready`, `replay_resume`, `replay_gap_snapshot_fallback`, `input_sent`, `ack`, `policy_reject`). |
| `result` | enum | yes | `ok`, `error`, or `rejected`. |
| `transport` | enum | yes | `ws` or `ssh`. |
| `sessionId` | string | yes | Runtime session identity. |
| `clientId` | string | yes | Caller identity. |
| `paneId` | string | conditional | Required for input/lane events. |
| `requestId` | string | conditional | Required for request/ack pairing. |
| `reason` | string | conditional | Required for `policy_reject` events. |
| `streamSeq` | integer | conditional | Required for replay events. |
| `lastSeq` | integer | conditional | Required for replay events. |
| `durationMs` | number | optional | Explicit latency when available; otherwise derive from paired events. |

### Canonical Metrics

| Metric name | Type | Unit | Source event(s) | Labels (low cardinality) | Rollup |
| --- | --- | --- | --- | --- | --- |
| `cr_connect_latency_ms` | histogram | ms | `connect_start` -> `connect_ready` (paired by `clientId`) | `transport`, `result` | p50/p95/p99 per 5m, weekly p95 |
| `cr_replay_lag_events` | gauge | events | `replay_resume` or `replay_gap_snapshot_fallback` | `transport`, `result` | max + p95 per 5m, weekly max |
| `cr_reconnect_total` | counter | count | `connect_start` with reconnect path (`lastSeq > 0`) | `transport`, `result` | rate/5m + weekly sum |
| `cr_input_ack_latency_ms` | histogram | ms | `input_sent` -> `ack` (paired by `requestId`) | `transport`, `result` | p50/p95 per 5m, weekly p95 |
| `cr_lane_conflict_total` | counter | count | `policy_reject` where `reason=input_lane_conflict` | `transport`, `sessionId` | rate/5m + weekly sum |
| `cr_kill_switch_block_total` | counter | count | `policy_reject` where `reason=input_disabled_kill_switch` | `transport` | rate/5m + weekly sum |

Derived replay lag formula:

`cr_replay_lag_events = max(0, streamSeq - lastSeq)` at replay decision time.

## Dashboard Baseline v1

Weekly checkpoint review must include these baseline panels.

| Panel ID | Panel title | Query intent | Weekly gate |
| --- | --- | --- | --- |
| `transport-01` | Connect latency p95 (ms) | `p95(cr_connect_latency_ms)` split by `transport` | Pass if p95 <= 500ms |
| `transport-02` | Reconnect count | `sum(increase(cr_reconnect_total[7d]))` by `transport` | Investigate if > 200/week per env |
| `replay-01` | Replay lag max + p95 | `max` and `p95` of `cr_replay_lag_events` | Pass if max <= 200 |
| `input-01` | Input ack latency p95 (ms) | `p95(cr_input_ack_latency_ms)` | Pass if p95 <= 250ms |
| `safety-01` | Lane conflicts | `sum(increase(cr_lane_conflict_total[7d]))` | Investigate if conflict rate >= 2% |
| `safety-02` | Kill-switch blocks | `sum(increase(cr_kill_switch_block_total[7d]))` | Pass if `0` unless incident/freeze declared |

### Weekly Threshold Table

| Metric | Target | Warn | Critical |
| --- | --- | --- | --- |
| Connect latency p95 | <= 500ms | > 500ms | > 1000ms |
| Replay lag max | <= 200 events | > 200 | > 500 |
| Reconnect total (7d) | <= 200 | > 200 | > 500 |
| Input ack latency p95 | <= 250ms | > 250ms | > 500ms |
| Lane conflict rate | < 2% of input attempts | >= 2% | >= 5% |
| Kill-switch blocks (normal ops) | 0 | > 0 | > 0 without declared incident |

## Minimum Weekly Evidence Pack v1

Each weekly checkpoint must include this minimum artifact set under `scripts/checkpoints/runs/`.

| Artifact | Path pattern | Required content |
| --- | --- | --- |
| Checkpoint summary | `YYYY-MM-DD-weekly-cross-platform-checkpoint.md` | Status, risks, decisions, sign-off. |
| Command evidence log | `YYYY-MM-DD-command-evidence.md` | Commands run, UTC timestamps, exit codes, pass/fail notes. |
| Metrics export | `YYYY-MM-DD-observability-metrics.json` | Metric rollups for six canonical metrics + threshold evaluation. |
| Dashboard baseline snapshot | `YYYY-MM-DD-dashboard-baseline.md` | Panel values for `transport-01`..`safety-02` and exceptions. |
| Soak/incident note | `YYYY-MM-DD-soak-or-incident.md` | 30-minute soak summary or explicit `not-run` reason with owner/date. |

### Evidence Metadata Schema (JSON)

```json
{
  "checkpointDate": "YYYY-MM-DD",
  "commitSha": "string",
  "environment": "dev|staging|prod-like",
  "facilitator": "string",
  "artifacts": [
    {
      "type": "checkpoint_summary|command_evidence|metrics_export|dashboard_snapshot|soak_or_incident",
      "path": "scripts/checkpoints/runs/<file>",
      "generatedAtUtc": "YYYY-MM-DDTHH:MM:SSZ",
      "sourceCommand": "string",
      "status": "pass|warn|fail|not-run"
    }
  ]
}
```

## Command-To-Evidence Mapping v1

| Command | Evidence artifact | Acceptance signal | Related metric/check |
| --- | --- | --- | --- |
| `npm run check` | `YYYY-MM-DD-command-evidence.md` | exit code `0` | build/type baseline |
| `npm test` | `YYYY-MM-DD-command-evidence.md` | exit code `0` | regression baseline |
| `npm run test:ci:all` | `YYYY-MM-DD-command-evidence.md` | exit code `0` | integrated CI parity |
| `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts` | `YYYY-MM-DD-command-evidence.md` | output contains `# fail 0` | contract/policy safety baseline |
| `node --import tsx --test src/bridge/bridge-engine.replay.test.ts src/server/bridge-server.replay.e2e.test.ts` | `YYYY-MM-DD-command-evidence.md` | output contains `# fail 0` | replay lag + reconnect correctness |
| `npm run bench:input -- --iterations 5` | `YYYY-MM-DD-dashboard-baseline.md` + `YYYY-MM-DD-soak-or-incident.md` | exit code `0`, latency summary captured | input ack latency weekly check |
| `npm run bench:input -- --iterations 3` (kill-switch validation) | `YYYY-MM-DD-soak-or-incident.md` | non-zero exit with input blocked evidence | kill-switch block confirmation |

Operational runbook reference: [Operations weekly evidence flow](./operations.md#weekly-observability-baseline-and-evidence-pack).
