# Android App (Proposed)

This folder hosts the native Android client for CommandRelay.

## Status

Architecture and bootstrap plan only. Implementation starts from this module layout.

## Objectives

1. Native Kotlin + Compose terminal client.
2. WebSocket transport matching `docs/protocol.md`.
3. Security and pairing behavior aligned with iOS.
4. Read-only default with explicit input enable.

## Bootstrap Plan

### Prerequisites

1. Android Studio (latest stable).
2. JDK 17.
3. Android SDK with API 34 platform and build tools.
4. Gradle wrapper managed in this folder.

### Create Project Skeleton

Run from repository root:

```bash
mkdir -p apps/android
cd apps/android

# initialize gradle
gradle init --type basic

# optional: create Android app scaffold with Android Studio wizard
# package: com.commandrelay.android
# minSdk: 26 (proposed)
# targetSdk: 34
```

### Initial Build Files

Create:

1. `settings.gradle.kts` with module includes.
2. Root `build.gradle.kts` for common plugin and dependency versions.
3. `gradle/libs.versions.toml` for dependency catalog.

## Proposed Module Layout

```text
apps/android/
  app/
  core/designsystem/
  core/protocol/
  core/transport/
  core/auth/
  core/terminal/
  core/lifecycle/
  data/repository/
  feature/sessions/
  feature/terminal/
  feature/pairing/
  feature/settings/
```

## Module Responsibilities

1. `app`: entry point, navigation graph, dependency graph assembly.
2. `core/protocol`: JSON event envelope and event payload models.
3. `core/transport`: websocket client, heartbeat, reconnect, backoff.
4. `core/auth`: pairing flow, token management, keystore integration.
5. `core/terminal`: terminal buffer, ANSI parsing, render-ready rows.
6. `data/repository`: app-facing repositories that combine transport and cache.
7. `feature/sessions`: list sessions and attach flow.
8. `feature/terminal`: terminal viewer, input controls, resize behavior.
9. `feature/pairing`: QR/deep-link pairing UX and trust establishment.
10. `feature/settings`: endpoint config, diagnostics, local credential reset.

## Dependency Direction

1. `feature:* -> data:repository + core:* + core:designsystem`.
2. `data:repository -> core:transport + core:auth + core:protocol`.
3. `core:*` modules must not depend on `feature:*`.

## Recommended Libraries

1. Compose BOM + Material 3.
2. Hilt for DI.
3. OkHttp for WebSocket transport.
4. Kotlinx Serialization for protocol JSON.
5. Room + DataStore for local state.
6. AndroidX Security Crypto for encrypted preference storage.

## MVP Milestones

1. M1: Pair + connect + auth + session list.
2. M2: Attach + stream + replay-capable terminal render (read-only).
3. M3: Controlled input enable/disable and input event path.
4. M4: Lifecycle hardening, diagnostics, and revoke/reset flows.

## Local Run Targets (future)

1. `./gradlew :app:assembleDebug`
2. `./gradlew :app:installDebug`
3. `./gradlew test`

## Notes

1. Keep all protocol field names identical to server docs.
2. Keep input disabled by default after reconnect unless policy explicitly restores it.
3. Treat pairing material as sensitive and non-exportable.
