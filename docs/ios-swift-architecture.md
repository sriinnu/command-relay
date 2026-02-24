# iOS Swift Architecture (CommandRelay)

This document defines the native iOS architecture for CommandRelay in Swift/SwiftUI.

## Goals

1. Keep iOS client secure-by-default and read-only by default.
2. Preserve low-latency output streaming with reliable reconnect/replay.
3. Build feature slices that can ship incrementally as MVP.
4. Isolate transport/protocol concerns from UI concerns.

## Non-Goals (MVP)

1. Running local shell sessions on iOS.
2. Full offline terminal history sync.
3. Multi-account support.

## M1 Kickoff Baseline (Scaffolded on February 24, 2026)

The first implementation scaffold now exists at `apps/ios/CommandRelay` with:

1. `project.yml` for deterministic Xcode project generation via `xcodegen`.
2. `CommandRelayApp` SwiftUI shell with three baseline feature views:
   - `AuthGateView`
   - `SessionListView`
   - `ReadOnlyStreamView`
3. `Packages/CommandRelayKit` package boundaries and protocol-first interfaces for:
   - auth pairing/token lifecycle (`AuthSessionServicing`)
   - session list discovery (`SessionListServicing`)
   - read-only attach/stream (`ReadOnlyStreamServicing`)

This baseline is intentionally stub-backed so transport, repositories, and rendering layers can be implemented incrementally without breaking top-level flow contracts.

## Module Design

Use one app target plus internal Swift package targets for boundaries.

1. `CommandRelayApp` (iOS app target)
2. `CoreKit` (cross-feature primitives)
3. `RelayProtocolKit` (event envelopes and payload models)
4. `TransportKit` (WebSocket client, reconnect, heartbeat)
5. `SessionDomainKit` (entities + use cases)
6. `SessionDataKit` (repository implementations)
7. `TerminalRenderKit` (terminal view adapter and buffer model)
8. `Features/*` (SwiftUI feature modules)

## Feature Modules

1. `FeaturePairing`: QR scan, device registration, trust confirmation.
2. `FeatureSessions`: list sessions/panes, attach entry point.
3. `FeatureTerminal`: live stream, resize, input toggle, command send.
4. `FeaturePolicy`: read-only/input state and guard rails.
5. `FeatureSettings`: device identity, revoke/unpair, diagnostics.

## Dependency Rules

1. Features depend only on Domain + Data protocol surfaces.
2. Domain has no dependency on UI, URLSession, AVFoundation, or Keychain APIs.
3. Transport and security implementations stay below Domain.
4. App target wires dependencies using explicit composition root.

## WebSocket Client Architecture

Build around an actor-backed connection manager.

### Core Types

1. `RelayWebSocketClient` (actor): connect, disconnect, send, receive loop.
2. `ConnectionStateMachine`: `idle -> connecting -> authenticated -> attached`.
3. `HeartbeatCoordinator`: interval ping and latency capture.
4. `ReplayCursorStore`: persists per-pane `lastSeq`.
5. `ReconnectPolicy`: exponential backoff with jitter and max cap.

### Handshake Flow

1. Open `wss://.../ws`.
2. Send `auth` envelope with short-lived token and device proof.
3. Receive `auth_ok` then request `list_sessions`.
4. On attach, send `attach` with pane and `lastSeq` for replay.

### Reliability Behavior

1. Single writer principle inside actor to avoid race conditions.
2. Outbound queue with bounded size; drop oldest non-critical events first.
3. Automatic reconnect on transient close/network loss.
4. Resume stream using `lastSeq + 1`.
5. Heartbeat timeout transitions to reconnect state.

## Terminal Rendering Approach

Use a native renderer path for MVP: `SwiftTerm` wrapped in SwiftUI.

### Why This Path

1. Native text rendering and input handling, no embedded browser dependency.
2. Better control of accessibility and keyboard integration.
3. Cleaner boundary for stream buffering and replay.

### Rendering Pipeline

1. Gateway `output.chunk` arrives in `TransportKit`.
2. `TerminalStreamReducer` appends bytes to ring buffer and advances `streamSeq`.
3. `TerminalRenderKit` applies ANSI/VT sequences to terminal surface.
4. UI renders via `TerminalViewRepresentable` in SwiftUI.

### Performance Constraints

1. Keep main-thread work limited to paint/update calls.
2. Coalesce burst updates using a short frame budget (for example 16-33ms).
3. Keep scrollback bounded (for example 5k-10k lines configurable).

### Fallback Plan

If ANSI parity gaps block shipping, allow a temporary `WKWebView + xterm.js` adapter behind a feature flag without changing Domain/Transport APIs.

## Background / Foreground Lifecycle

iOS does not allow persistent real-time sockets indefinitely in background; architecture must reconnect fast and preserve cursor state.

### On Foreground (`scenePhase == .active`)

1. Resume connection manager.
2. Re-authenticate with fresh token if required.
3. Re-attach active pane with persisted `lastSeq`.
4. Request missed output replay.

### On Background (`scenePhase == .background`)

1. Persist active pane ID and latest `streamSeq`.
2. Best-effort send `disable_input` for safety.
3. Close socket gracefully to avoid stale half-open state.
4. End with read-only mode when app returns.

### On Inactive (`scenePhase == .inactive`)

1. Pause command entry UI.
2. Keep short grace timer to avoid reconnect thrash during transient app switches.

## Security and Auth Pairing (QR)

Pairing should be out-of-band with one-time credentials and device-bound keys.

### Pairing Data in QR

1. Relay endpoint (`wss` + API base URL).
2. One-time pairing code (short TTL, single-use).
3. Relay ID and human-verifiable fingerprint hint.
4. Expiry timestamp.

### Pairing Flow

1. User scans QR in `FeaturePairing` (`AVCaptureSession`).
2. App validates expiry and endpoint format.
3. App generates `P256.Signing` key in Secure Enclave if available.
4. App calls `POST /pair/claim` with pairing code + public key.
5. Gateway sends challenge nonce.
6. App signs nonce and submits proof.
7. Gateway returns `deviceId`, refresh token, and access token metadata.

### Credential Storage

1. Refresh token in Keychain (`ThisDeviceOnly`, non-migratable).
2. Private key non-exportable (Secure Enclave when available).
3. Access tokens in-memory only.
4. Optional biometric gate before enabling input mode.

### Session Auth on WebSocket

1. Fetch short-lived access token from refresh token.
2. Send `auth` event including token and signed challenge proof.
3. Gateway returns capability set (`read_only`, `can_enable_input`, pane ACL).

## MVP Feature Slices

1. Slice A: Pair Device
   - QR scan, claim, challenge-sign, keychain persist, unpair.
2. Slice B: Session Browser (Read-Only)
   - Auth, `list_sessions`, session list UI, attach action.
3. Slice C: Terminal Stream (Read-Only)
   - Attach, receive output, terminal render, replay after reconnect.
4. Slice D: Input Guard Rails
   - Explicit enable input, hold-to-confirm control, disable input.
5. Slice E: Reconnect + Lifecycle Hardening
   - Backoff policy, heartbeat timeout, foreground resume from `lastSeq`.
6. Slice F: Security and Diagnostics
   - Device metadata page, connection logs, revoke/unpair path.

## Suggested Metrics

1. p95 attach-to-first-byte latency.
2. Reconnect success rate within 5 seconds.
3. Percentage of sessions remaining read-only.
4. Input enable/disable audit event completeness.

## Open Decisions

1. Final terminal engine choice (`SwiftTerm` vs internal renderer).
2. Biometric requirement policy before input enable.
3. Replay buffer size defaults for mobile bandwidth constraints.
