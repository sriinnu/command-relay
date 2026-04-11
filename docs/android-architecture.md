# Android Architecture

This document defines the Android native architecture for CommandRelay using Kotlin and Jetpack Compose.

## Goals

1. Keep protocol and security semantics aligned with iOS.
2. Preserve CommandRelay defaults: read-only first, explicit input enable.
3. Deliver low-latency streaming and resilient reconnect behavior.
4. Keep module boundaries clean for parallel development.

## Client Role in System

Android is a first-class client over WebSocket JSON events.

1. Authenticate and maintain capability state (`view`, `input`).
2. Discover sessions and attach to panes.
3. Render terminal output with replay and sequence ordering.
4. Send input only when input is explicitly enabled.

## Technology Baseline

1. Language: Kotlin.
2. UI: Jetpack Compose + Material 3.
3. Concurrency: Kotlin Coroutines + Flow.
4. DI: Hilt.
5. Transport: OkHttp WebSocket.
6. Serialization: Kotlinx Serialization.
7. Persistence: Room (local cache) + DataStore (small settings).
8. Crypto and secure storage: Android Keystore + EncryptedSharedPreferences.

## Batch Outcomes (2026-02-24)

### Android Parity Module Outcome

Android parity is now defined as a first-class boundary contract, not a UI-only milestone.

1. Parity module boundary is `data:repository` over `core:protocol`, `core:transport`, and `core:auth`.
2. Required parity behaviors are locked for Android implementation:
   - read-only default after auth/reconnect
   - attach with `lastSeq`
   - replay-safe stream ordering by `streamSeq`
   - explicit input enable/disable controls
3. The current repository state for `apps/android` remains architecture-first (`apps/android/README.md`), ready for module scaffold execution without changing parity semantics.

Tonight parity verification commands on Mac (server-contract side):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/protocol.conformance.test.ts
node --import tsx --test src/server/ws-contract-matrix.test.ts
node --import tsx --test src/server/bridge-server.policy.test.ts
```

## Proposed Module Layout

```text
apps/android/
  app/                        -> Android app shell, navigation, DI wiring
  core:designsystem           -> theme, typography, spacing, reusable UI primitives
  core:protocol               -> websocket event models and serialization
  core:transport              -> websocket client, reconnect policy, heartbeat
  core:auth                   -> pairing, token lifecycle, secure key/token storage
  core:terminal               -> terminal state model, ANSI parser, rendering adapter
  core:lifecycle              -> foreground/background policy and session coordinator
  feature:sessions            -> session list, filters, attach actions
  feature:terminal            -> terminal screen, input controls, resize behavior
  feature:settings            -> endpoint, diagnostics, device registration info
  feature:pairing             -> pairing UX and device trust management
  data:repository             -> repositories joining transport, cache, and domain logic
  benchmark/ (optional)       -> macrobenchmark for startup and frame stability
```

## Layer Boundaries

1. `feature:*` depends on `data:repository`, `core:*`, and `core:designsystem`.
2. `data:repository` depends on `core:transport`, `core:auth`, `core:protocol`, and local persistence.
3. `core:*` modules do not depend on `feature:*`.
4. `app` depends on all modules only for assembly.

## WebSocket Transport Strategy

### Event Contract

Use the existing envelope from `docs/protocol.md`.

1. Every outbound event includes client-generated `requestId`.
2. `streamSeq` is tracked per pane.
3. Reconnect attach sends `lastSeq` for replay recovery.

### Connection State Machine

```text
DISCONNECTED -> CONNECTING -> AUTHENTICATED_READ_ONLY -> ATTACHED_STREAMING
```

Additional transitions:

1. `AUTHENTICATED_READ_ONLY -> INPUT_ENABLED` only after explicit user action.
2. Any socket failure moves to `DISCONNECTED` and starts backoff.
3. Auth failure moves to `TERMINATED` until new credentials/pairing.

### Reliability Controls

1. Heartbeat interval: 15s default, configurable from policy update.
2. Exponential backoff with jitter: 1s, 2s, 4s ... capped at 30s.
3. Connection attempt cancellation when app is backgrounded longer than idle threshold.
4. Replay dedupe by `(paneId, streamSeq)`.

## Terminal Rendering Strategy (Compose)

### Decision

Use a hybrid strategy:

1. `core:terminal` owns terminal buffer, cursor, color attrs, and ANSI parsing.
2. `feature:terminal` renders visible rows using Compose `LazyColumn` + monospace text.
3. Rendering is row-diff driven to avoid full-screen recomposition on every chunk.

### Scope for MVP

1. Support UTF-8 text, newlines, carriage return, backspace, and common ANSI SGR colors.
2. Handle resize events from screen/IME changes with debounced `resize` event.
3. Keep scrollback buffer bounded (for example 5,000 lines) with drop-oldest policy.

### Post-MVP Enhancements

1. Full VT parser compatibility for advanced TUIs.
2. Alternate screen buffer mode support.
3. Selection, copy, search-in-buffer, and semantic jump links.

## Lifecycle Behavior

### Foreground/Background

1. Foreground: maintain active websocket and heartbeats.
2. Background under short timeout (for example < 60s): keep socket alive if OS allows.
3. Background over timeout: gracefully detach stream, persist `lastSeq`, close socket.

### Resume Behavior

1. Reconnect and re-auth immediately.
2. Re-attach the previously active pane with `lastSeq`.
3. Start in read-only mode unless server capability says input is still valid.

### Input Safety Behavior

1. Input toggle is session-scoped and visibly prominent.
2. Input auto-expires after policy TTL or when app backgrounds.
3. Critical commands can require extra local confirmation (policy-driven).

## Secure Auth and Pairing (iOS Alignment)

Define cross-platform invariants shared by iOS and Android.

1. Read-only default after every fresh auth.
2. Input requires explicit enable and can be revoked remotely.
3. Device registration is explicit and auditable.
4. Tokens are short-lived and bound to registered device identity.

### Pairing Flow

1. User starts pairing on trusted host.
2. Android scans QR/deep link containing one-time pairing code and gateway endpoint.
3. App generates device keypair in Android Keystore (EC P-256).
4. App submits pairing code + device public key.
5. Gateway returns device-bound refresh/access credentials.
6. Credentials are stored encrypted; private key never leaves Keystore.

### Platform Mapping

1. iOS Secure Enclave/Keychain <-> Android Keystore/Encrypted storage.
2. Same token rotation, revocation, and expiry semantics.
3. Same audit events: `pair`, `auth`, `attach`, `enable_input`, `input`, `disable_input`.

### Revocation and Recovery

1. Server-side revoke invalidates refresh/access immediately.
2. App detects auth error, clears volatile session, and returns to pairing-required state.
3. User can wipe local trust material from settings.

## MVP Delivery Slices

### Slice 1: Connectivity and Read-Only Terminal

1. Pairing bootstrap with stored credentials.
2. WebSocket connect/auth/heartbeat/reconnect.
3. Session list + attach + output stream + replay.
4. Compose terminal viewer (read-only).

### Slice 2: Controlled Input

1. Explicit enable/disable input controls.
2. Session-scoped input state and visible indicator.
3. Input path with ack/error handling and audit-friendly request IDs.

### Slice 3: Lifecycle Hardening

1. Background policy implementation with graceful detach.
2. Resume auto-reattach with `lastSeq` recovery.
3. Local persistence of selected pane and scrollback snapshot metadata.

### Slice 4: Security and Ops Fit

1. Device management screen (trust status, revoke local creds).
2. Policy update handling from gateway (`policy_update`).
3. Diagnostics page for connection state, latency, last replay gap.

## Non-Goals for MVP

1. Multi-pane split-screen terminal UI.
2. Full desktop-class terminal emulation parity.
3. Offline command queueing.

## Testing Strategy

1. Unit tests for protocol codecs, replay ordering, and auth state machine.
2. Integration tests with mocked websocket server for reconnect and replay.
3. UI tests for read-only vs input-enabled transitions.
4. Soak test for long-running stream and orientation changes.

## Open Decisions

1. Final ANSI parser implementation choice in `core:terminal`.
2. Whether to keep background socket alive using foreground service for operator mode.
3. Minimum Android SDK based on crypto and websocket support constraints.
