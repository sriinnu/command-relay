---
name: "commandrelay-orchestrator"
description: "Use for production work in this repository: terminal/runtime wiring, remote control safety, proxy package hardening, native-web parity, and multi-agent execution with Chitragupta as co-orchestrator."
---

# CommandRelay Orchestrator

This skill is for production work on `command-relay`: remote/local terminal control, runtime backends, proxy ecosystem packages, and native client parity.

## Trigger Conditions

Use this skill when requests involve any of:

1. Runtime/backends: `tmux`, `cmux`, backend muxing, pane routing, attach/replay/input flows.
2. Remote control: bi-directional command execution, safety gates, lane conflicts, takeover behavior.
3. Proxy packages: `@commandrelay/proxy-*`, `@commandrelay/relay-proxy`, adapter hardening, release gates.
4. Cross-platform clients: iOS/Android/macos/web fallback protocol parity.
5. Parallel execution: spawn multiple agents and orchestrate to completion.

## Non-Negotiable Rules

1. Always use Chitragupta as co-orchestrator for planning, memory, and stress checks.
2. Keep repository standards:
   - no source file over 450 LOC
   - JSDoc for exported functions/classes/components/hooks
   - strict TypeScript style where practical
3. Do not copy third-party code directly; learn patterns and implement first-party equivalents.
4. Preserve read-only-by-default remote input policy unless explicitly changed by user direction.
5. Enforce distilled context orchestration policy:
   - deterministic first (explicit task + owned files + output shape)
   - minimal context capsules only
   - close agents fast when done/stalled
   - redact secrets in all capsule payloads
   - strict file-ownership scope per agent

## Standard Workflow

1. **Load context**
   - Read `README.md`, `docs/TODO.md`, `AGENTS.md`.
   - Check key docs: `docs/protocol-v1.md`, `docs/security.md`, `docs/operations.md`.
2. **Plan in parallel**
   - Split into narrow work streams and spawn agents with clear file ownership.
   - Keep one integration owner to merge and verify.
3. **Implement**
   - Prefer minimal, testable increments.
   - Keep protocol and behavior backward-compatible unless user requests a break.
4. **Validate**
   - `npm run check:root`
   - `npm run test:root`
   - `npm run ci:all` for merge-quality changes
5. **Push**
   - Commit cohesive units with explicit scope.
   - Push to current feature branch and report exact commit IDs.

## Capsule + Brief + Dispatch CLI (Distilled Context)

Use capsule build + brief generation + dispatch to keep orchestration deterministic and low-leakage.
Command paths: `npm run capsule:build --` then `npm run capsule:brief --` then `npm run capsule:dispatch --`.

```bash
npm run capsule:build -- --help

npm run capsule:build -- \
  --goal "Update distilled context docs policy" \
  --owner docs-policy \
  --path skills/commandrelay-orchestrator/SKILL.md \
  --path docs/operations.md \
  --accept "Replace stale capsule/brief script references" \
  --risk "Over-broad context increases leakage risk" \
  --out /tmp/docs-policy.capsule.json

npm run capsule:brief -- \
  --capsule /tmp/docs-policy.capsule.json \
  --task "Update distilled context docs policy" \
  --owner docs-policy \
  --path skills/commandrelay-orchestrator/SKILL.md \
  --path docs/operations.md \
  --out /tmp/docs-policy.brief.md

npm run capsule:dispatch -- \
  --brief /tmp/docs-policy.brief.md \
  --task "Update distilled context docs policy" \
  --owner docs-policy \
  --path skills/commandrelay-orchestrator/SKILL.md \
  --path docs/operations.md \
  --agent-type worker \
  --instruction "You are not alone in the codebase; respect owned file scope." \
  --out /tmp/docs-policy.dispatch.json
```

## Chitragupta Co-Orchestrator Runbook

At start of substantial work:

1. `mcp__chitragupta__chitragupta_context` (load memory for this project).
2. `mcp__chitragupta__health_status` and `mcp__chitragupta__atman_report`.
3. Use `spawn_agent`/parallel agents for implementation tracks.

Stress/health checks (run periodically and before final handoff):

1. `mcp__chitragupta__chitragupta_prompt` quick self-check.
2. `mcp__chitragupta__mesh_status` + `mesh_topology`.
3. If mesh actors are used: verify `mesh_ask` request-reply behavior; report timeouts/regressions immediately.

Persist user preferences:

1. Write durable preferences with `mcp__chitragupta__memory` (`scope=project`).
2. Mirror operationally critical preferences in `AGENTS.md`.

## Runtime/Control-Lane Guardrails

1. Keep event envelope contract consistent across clients.
2. Preserve safety sequence:
   - `enable_input` -> `input` -> `disable_input`
   - enforce kill switch and rate/size limits
3. Multi-backend routing:
   - single backend: native pane IDs unchanged
   - multi-backend: backend-namespaced pane IDs
4. No web-only protocol fork for control-lane semantics.

## Proxy Ecosystem Guardrails

For `@commandrelay/proxy-*` or `@commandrelay/relay-proxy` changes:

1. Keep root exports stable; avoid deep-import guidance.
2. Enforce typed error boundaries and lifecycle cleanup (`destroy`/`dispose`).
3. Maintain env semantics (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`) with tests.
4. Require release artifacts:
   - README + NOTES + examples
   - compatibility and perf evidence
   - security/compliance checklist updates

## Definition of Done

A task is done only when all are true:

1. Implementation complete and integrated.
2. Validation commands pass.
3. Documentation/TODO updates included when behavior or roadmap changes.
4. Branch pushed and status communicated with commit hash.
