# CommandRelay Docs

This folder contains project documentation for users, contributors, and operators.

> **Docs summary:** Architecture, protocol, operations, and native roadmap docs for the CommandRelay TypeScript gateway.
> **Freshness policy:** keep `/docs` evergreen; record date-stamped execution evidence in `scripts/checkpoints/runs/*.md`.

## Distilled Context Workflow (Cost + Leakage)

1. Deterministic first: define exact task, owned files, and expected output before spawning agents.
2. Use minimal task capsules: include only required snippets/interfaces, not broad repository context.
3. Close agents fast when complete or stalled; relaunch with narrower scope when needed.
4. Redact secrets from all capsules/prompts/logs (tokens, keys, credentials, raw `.env` values).
5. Scope work by owned files only to avoid overlap and accidental leakage.
6. Command examples for `capsule:build`, `capsule:brief`, and `capsule:dispatch` live in [operations.md](operations.md).
7. Read-only audit mode: `npm run orchestration:plan-audit -- --step <n> --label "<text>" -- <read-only command...>` with role rules in [orchestration/subagent-contract.md](orchestration/subagent-contract.md).

## Runtime Snapshot

1. Gateway runtime: TypeScript on Node.js `>=22` (`tsx` execution, `tsc --noEmit` checks).
2. SSH-first transport with current WS runtime path: data plane remains WebSocket (`/ws`), and `ssh` mode executes tmux runtime operations on the remote target after startup preflight passes (see `ssh-transport-contract.md` and ADR-001).
3. Outbound proxy package set: `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`, `pac-proxy-agent`.
4. Client ecosystem direction: iOS (Swift) first, Android (Kotlin) second, web fallback last.

Local MCP note:
1. If local `tsx` startup throws `EPERM`, run chitragupta MCP with `node --import tsx packages/cli/src/mcp-entry.ts` (documented in [Operations](operations.md)).

## Audience Paths

1. New user: start with [Getting Started](getting-started.md).
2. Contributor: read [Architecture](architecture.md), then [Protocol](protocol.md).
3. Operator: read [Operations](operations.md) and [Security](security.md).
4. Mobile builder: read [Getting Started](getting-started.md) for `M0ProtocolMockClient`, then [iOS Swift Architecture](ios-swift-architecture.md) and [Android Architecture](android-architecture.md).
5. Planner: read [Native Roadmap](roadmap-native.md), [Execution TODO](TODO.md), and [Subagent Contract](orchestration/subagent-contract.md).
6. Release owner: read [Proxy Publish Runbook](release/proxy-publish.md) and capture outputs in weekly checkpoints.

## Quickstart References

1. [getting-started.md](getting-started.md): runtime quickstart and live environment setup.
2. [operations.md](operations.md): operator runbook and runtime behavior details.
3. SSH startup config keys: `COMMANDRELAY_TRANSPORT_MODE`, `COMMANDRELAY_SSH_PROFILE`, `COMMANDRELAY_SSH_TARGET`, `COMMANDRELAY_SSH_COMMAND`, `COMMANDRELAY_SSH_PORT`, `COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS`, `COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING`.
4. Tunnel helper runbook: [../scripts/ssh/README.md](../scripts/ssh/README.md).

## Discoverability + Extension CLI

1. List discoverable skills (table): `npm run discover:skills`.
2. List discoverable skills (JSON): `npm run discover:skills:json`.
3. List discoverable apps/extensions (table): `npm run discover:apps`.
4. List discoverable apps/extensions (JSON): `npm run discover:apps:json`.
5. List allowlisted extension actions: `npm run extension:run -- --list`.
6. Execute an extension action: `npm run extension:run -- <extension-id> <action> [-- <args...>]`.
7. Example package action: `npm run extension:run -- proxy-core check`.
8. Example app metadata call: `npm run extension:run -- web info`.
9. Example app runtime preview: `npm run extension:run -- web preview -- --port 4173`.

## Current Execution Baselines

1. iOS protocol mock package path: `apps/ios/M0ProtocolMockClient` (`swift test`).
2. Protocol contract matrix entrypoint: `node --import tsx --test src/protocol.conformance.test.ts`.
3. Local MCP/chitragupta entrypoint workaround: `node --import tsx packages/cli/src/mcp-entry.ts --stdio --project ... --agent`.

## Production Readiness Path

1. Validate runtime and protocol gates from [Getting Started](getting-started.md) and [Operations](operations.md).
2. Run release gates from [release/proxy-publish.md](release/proxy-publish.md) in `dry-run` mode first.
3. Record evidence in `scripts/checkpoints/runs/YYYY-MM-DD-weekly-cross-platform-checkpoint.md`.

## Document Index

1. [getting-started.md](getting-started.md)
2. [architecture.md](architecture.md)
3. [protocol.md](protocol.md)
4. [security.md](security.md)
5. [operations.md](operations.md)
6. [naming.md](naming.md)
7. [ios-swift-architecture.md](ios-swift-architecture.md)
8. [android-architecture.md](android-architecture.md)
9. [roadmap-native.md](roadmap-native.md)
10. [macos-menu-bar-control-lane-spec.md](macos-menu-bar-control-lane-spec.md)
11. [control-lane-parity-checklist.md](control-lane-parity-checklist.md)
12. [controlled-input-audit.md](controlled-input-audit.md)
13. [proxy-ecosystem-roadmap.md](proxy-ecosystem-roadmap.md)
14. [research-next-opportunities.md](research-next-opportunities.md)
15. [TODO.md](TODO.md)
16. [release/proxy-publish.md](release/proxy-publish.md)
17. [ssh-transport-contract.md](ssh-transport-contract.md)
18. [adr/ADR-001-ssh-first-transport.md](adr/ADR-001-ssh-first-transport.md)
19. [architecture/host-state-authority-plan.md](architecture/host-state-authority-plan.md)
20. [orchestration/subagent-contract.md](orchestration/subagent-contract.md)
