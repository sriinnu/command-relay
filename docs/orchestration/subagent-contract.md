# Subagent Contract (Planner / Scout / Reviewer / Worker)

Last updated: 2026-03-03

## Purpose

Define deterministic roles, bounded concurrency, file ownership, and handoff rules for multi-agent execution in this repository.

## Roles

### Planner

- Creates execution graph and step ordering.
- Defines acceptance criteria and evidence expectations for each step.
- Must not perform broad edits; only planning docs/checklists.

### Scout

- Performs read-only discovery and gap analysis.
- Produces precise file/symbol anchors and risk notes.
- Must not modify source files.

### Reviewer

- Verifies behavior, regressions, and evidence quality.
- Prioritizes findings by severity with file references.
- Must not own feature implementation files.

### Worker

- Owns implementation slice with explicit file scope.
- Ships code/tests/docs for that slice.
- Must not edit outside assigned paths.

## Execution Rules

1. Every substantial cycle must include explicit owner + file scope per agent.
2. Default max active workers: `3` (increase only when ownership does not overlap).
3. No overlapping edits unless a handoff owner is named.
4. All worker outputs must include:
   - changed files
   - commands run
   - pass/fail outcomes
   - residual risks
5. Close agents immediately after completion or stall.

## Handoff Template

Use this exact structure in agent outputs:

1. `Owned Files`
2. `What Changed`
3. `Validation`
4. `Open Risks`
5. `Next Handoff Owner`

## Plan Mode (Read-Only Audit)

Use `scripts/orchestration/plan-mode-audit.sh` for read-only audit steps with deterministic completion markers.

Example:

```bash
scripts/orchestration/plan-mode-audit.sh \
  --step 1 \
  --label "List release gates" \
  -- rg -n "Gate" docs/TODO.md
```

Pass signal:

- `[DONE:1] List release gates`

