# A2 tmux Fixture Harness Evidence - 2026-02-27

- Captured (UTC): 2026-02-27T15:26:10.699Z
- Status: `fail`
- Artifact path: `/mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/checkpoints/runs/2026-02-27-a2-tmux-fixture-harness-evidence.md`

## Command

`node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts --session fixture_a2_evidence --window fixture --panes 3 --profile replay --cycles 4 --lines-per-cycle 3 --delay-ms 0`

## Command Stages

| Stage | Status | Duration (ms) | Invocation |
| --- | --- | --- | --- |
| create-fixture | pass | 48 | `bash /mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/tmux-fixtures/create-fixture.sh --session fixture_a2_evidence --window fixture --panes 3 --force-recreate` |
| emit-fixture-output | pass | 270 | `bash /mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_a2_evidence --window fixture --profile replay --cycles 4 --lines-per-cycle 3 --delay-ms 0` |
| teardown-fixture | pass | 25 | `bash /mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/tmux-fixtures/teardown-fixture.sh --session fixture_a2_evidence --if-missing-ok` |

## Pane Capture Summary

| Pane Index | Pane ID | Fixture Events Captured |
| --- | --- | --- |
| 0 | %0 | 0 |
| 1 | %2 | 0 |
| 2 | %1 | 0 |

## Replay Ordering Assertions

| Assertion | Status | Detail |
| --- | --- | --- |
| pane_count_matches_expected | pass | expected 3, actual 3 |
| total_event_count | fail | expected 36, actual 0 |
| pane_0_event_count | fail | expected 12, actual 0 |
| pane_1_event_count | fail | expected 12, actual 0 |
| pane_2_event_count | fail | expected 12, actual 0 |
| global_sequence_continuous | pass | validated 0 events |
| replay_order_matches_emit_schedule | fail | expected 36 ordered events, actual 0 |

## Failure Summary

- total_event_count: expected 36, actual 0

## Operator Notes

- This evidence run is deterministic when tmux availability and fixture scripts are unchanged.
- The harness is idempotent for the same session name because it force-recreates only marked fixture sessions.
