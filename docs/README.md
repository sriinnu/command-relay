# CommandRelay Docs

This folder contains project documentation for users, contributors, and operators.

> **Docs summary:** Architecture, protocol, operations, and native roadmap docs for the CommandRelay TypeScript gateway.

## Runtime Snapshot

1. Gateway runtime: TypeScript on Node.js `>=22` (`tsx` execution, `tsc --noEmit` checks).
2. Gateway transport package: `ws`.
3. Outbound proxy package set: `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`, `pac-proxy-agent`.
4. Client ecosystem direction: iOS (Swift) first, Android (Kotlin) second, web fallback last.

## Audience Paths

1. New user: start with [Getting Started](getting-started.md).
2. Contributor: read [Architecture](architecture.md), then [Protocol](protocol.md).
3. Operator: read [Operations](operations.md) and [Security](security.md).
4. Mobile builder: read [iOS Swift Architecture](ios-swift-architecture.md) and [Android Architecture](android-architecture.md).
5. Planner: read [Native Roadmap](roadmap-native.md) and root [TODO](../TODO.md).

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
