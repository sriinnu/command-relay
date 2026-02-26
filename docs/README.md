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
6. Command examples for `task-capsule` live in [operations.md](operations.md).

## Runtime Snapshot

1. Gateway runtime: TypeScript on Node.js `>=22` (`tsx` execution, `tsc --noEmit` checks).
2. Gateway transport package: `ws`.
3. Outbound proxy package set: `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`, `pac-proxy-agent`.
4. Client ecosystem direction: iOS (Swift) first, Android (Kotlin) second, web fallback last.

Local MCP note:
1. If local `tsx` startup throws `EPERM`, run chitragupta MCP with `node --import tsx packages/cli/src/mcp-entry.ts` (documented in [Operations](operations.md)).

## Audience Paths

1. New user: start with [Getting Started](getting-started.md).
2. Contributor: read [Architecture](architecture.md), then [Protocol](protocol.md).
3. Operator: read [Operations](operations.md) and [Security](security.md).
4. Mobile builder: read [Getting Started](getting-started.md) for `M0ProtocolMockClient`, then [iOS Swift Architecture](ios-swift-architecture.md) and [Android Architecture](android-architecture.md).
5. Planner: read [Native Roadmap](roadmap-native.md) and [Execution TODO](TODO.md).
6. Release owner: read [Proxy Publish Runbook](release/proxy-publish.md) and capture outputs in weekly checkpoints.

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
12. [proxy-ecosystem-roadmap.md](proxy-ecosystem-roadmap.md)
13. [research-next-opportunities.md](research-next-opportunities.md)
14. [TODO.md](TODO.md)
15. [release/proxy-publish.md](release/proxy-publish.md)
