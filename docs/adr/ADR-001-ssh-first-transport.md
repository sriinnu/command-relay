# ADR-001: SSH-First Transport

## Status
Accepted

## Date
2026-02-27

## Context
- CommandRelay needs resilient remote control across disconnects and client restarts.
- Session durability depends on `tmux` reattach/replay semantics.
- A WebSocket-first default increases exposed network surface and deployment variance.
- SSH is already standard in operator environments with mature auth and host trust controls.

## Decision
- Set SSH as the default transport for CommandRelay.
- Keep `tmux` as the persistence layer, independent of transport lifecycle.
- Keep WebSocket available as explicit opt-in fallback for constrained environments.

## Rationale
- SSH reuses proven security controls (keys, host verification, access policy).
- Default exposure is narrower than opening a WebSocket endpoint by default.
- SSH attach/detach behavior aligns with `tmux` session continuity goals.
- Operators can use existing tooling and runbooks instead of introducing new transport infrastructure.

## Tradeoffs
- SSH provisioning and key management are required.
- Browser-only clients need a bridge or gateway for SSH workflows.
- Some environments may see slower reconnect UX than long-lived WebSocket connections.

## Consequences
- Product UX must treat SSH auth and host trust failures as first-class paths.
- Test coverage must include host-key checks, auth failures, reconnect, and replay.
- Docs and operational playbooks must position WebSocket as exception flow, not baseline.

## Alternatives considered
- WebSocket-first default: rejected due to larger exposed surface and proxy/TLS drift risk.
- Custom transport protocol: rejected due to long-term maintenance burden.
- Dual equal default (SSH + WebSocket): rejected to avoid ambiguous guidance and split testing focus.

## Rollout/rollback triggers
- Roll out once SSH path is feature-complete for attach, replay, input guardrails, and failure handling.
- Keep WebSocket fallback during migration for controlled cases.
- Trigger rollback review if SSH path shows sustained reliability or security regressions that cannot be mitigated operationally.
