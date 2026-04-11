# 2026-03-03 A6 Flaky-Network Soak and Live Bench Checkpoint

## Scope

- Branch: `feat/home-pickup-remaining-todos`
- Commit: `6c7d2e5`
- Track: `A6` release criteria evidence update
- Focus:
  - 30-minute flaky-network reconnect/replay soak
  - live command-latency evidence pack
  - kill-switch behavior signal in input benchmark path

## Soak Summary (30 Minutes)

Source: [2026-03-03-flaky-network-soak-summary.json](./2026-03-03-flaky-network-soak-summary.json)

- `startedAtUtc`: `2026-03-03T14:23:25.848Z`
- `endedAtUtc`: `2026-03-03T14:53:25.980Z`
- `durationMinutes`: `30.002`
- `cycles`: `1451`
- `reconnects`: `1450`
- `outputEventsSeen`: `22423`
- `lastObservedStreamSeq`: `22423`
- `replayResumeCount`: `1381`
- `replayGapSnapshotFallbackCount`: `69`
- `maxReplayLag`: `3`
- `replayMismatchCount`: `0`
- `pass`: `true`

Interpretation: replay correctness remained intact under repeated reconnect/drop cycles (no mismatches).

## Live Bench Evidence

Artifact directory: [artifacts/2026-03-03-a6-live-bench](../../../artifacts/2026-03-03-a6-live-bench)

- connect latency: [connect-latency.json](../../../artifacts/2026-03-03-a6-live-bench/connect-latency.json)
  - `openLatency p95`: `1.707ms`
  - `helloLatency p95`: `2.047ms`
- list roundtrip: [list-roundtrip.json](../../../artifacts/2026-03-03-a6-live-bench/list-roundtrip.json)
  - `roundtrip p95`: `5.1ms`
- input ack (kill-switch off): [input-ack-off.json](../../../artifacts/2026-03-03-a6-live-bench/input-ack-off.json)
  - `inputAck p95`: `3.243ms`

## Kill-Switch Behavior Signal

- health snapshot (kill-switch off): [health-off.json](../../../artifacts/2026-03-03-a6-live-bench/health-off.json) -> `"globalInputDisabled": false`
- health snapshot (kill-switch on): [health-on.json](../../../artifacts/2026-03-03-a6-live-bench/health-on.json) -> `"globalInputDisabled": true`
- input bench failure when kill-switch on: [input-ack-on.stderr.log](../../../artifacts/2026-03-03-a6-live-bench/input-ack-on.stderr.log)
  - error text: `input remains disabled after enable_input (global kill switch may be enabled)`

This run confirms kill-switch enforcement blocks live input in benchmark mode when enabled.

## A6 Criteria Mapping (2026-03-03)

- `7-day stability window`: `partial` (single 30-minute run is available, not 7 days).
- `30-minute flaky-network stream test`: `done` (pass with `replayMismatchCount=0`).
- `Controlled input opt-in on every reconnect path`: `partial` (baseline signals exist, but reconnect-path proof remains incomplete).
- `Full parity checklist across active clients`: `partial`.
- `On-call incident/runbook complete and reviewed`: `partial` in A6 lane (operator runbook exists in `A4`, but A6 checklist is not fully reconciled).
