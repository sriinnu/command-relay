# A2 tmux Fixture Harness Evidence - 2026-02-27

- Captured (UTC): 2026-02-27T15:45:57.396Z
- Status: `pass`
- Artifact path: `/mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/checkpoints/runs/2026-02-27-a2-tmux-fixture-harness-evidence.md`

## Command

`node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts --session fixture_a2_diag3 --window fixture --panes 3 --profile replay --cycles 2 --lines-per-cycle 2 --delay-ms 0`

## Command Stages

| Stage | Status | Duration (ms) | Invocation |
| --- | --- | --- | --- |
| create-fixture | pass | 58 | `bash /mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/tmux-fixtures/create-fixture.sh --session fixture_a2_diag3 --window fixture --panes 3 --force-recreate` |
| emit-fixture-output | pass | 91 | `bash /mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_a2_diag3 --window fixture --profile replay --cycles 2 --lines-per-cycle 2 --delay-ms 0` |
| teardown-fixture | pass | 26 | `bash /mnt/c/sriinnu/personal/Kaala-brahma/terminal/scripts/tmux-fixtures/teardown-fixture.sh --session fixture_a2_diag3 --if-missing-ok` |

## Pane Capture Summary

| Pane Index | Pane ID | Fixture Events Captured |
| --- | --- | --- |
| 0 | %9 | 4 |
| 1 | %11 | 4 |
| 2 | %10 | 4 |

## Replay Ordering Assertions

| Assertion | Status | Detail |
| --- | --- | --- |
| pane_count_matches_expected | pass | expected 3, actual 3 |
| total_event_count | pass | expected 12, actual 12 |
| pane_0_event_count | pass | expected 4, actual 4 |
| pane_1_event_count | pass | expected 4, actual 4 |
| pane_2_event_count | pass | expected 4, actual 4 |
| global_sequence_continuous | pass | validated 12 events |
| replay_order_matches_emit_schedule | pass | all events matched expected replay ordering |

## Operator Notes

- This evidence run is deterministic when tmux availability and fixture scripts are unchanged.
- The harness is idempotent for the same session name because it force-recreates only marked fixture sessions.
