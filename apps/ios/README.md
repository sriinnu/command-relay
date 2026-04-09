# CommandRelay iOS

This directory now includes the M1 kickoff scaffold for a Swift/SwiftUI iOS client with clear boundaries for:

1. Auth pairing/token flow interfaces.
2. Session list flow interfaces.
3. Read-only terminal stream flow interfaces.

## Current Scaffold

```text
apps/ios/
  README.md
  CommandRelay/
    project.yml
    CommandRelayApp/
      App/
        CommandRelayApp.swift
        AppDependencies.swift
        AppRootView.swift
      Features/
        Auth/
          AuthGateView.swift
        Sessions/
          SessionListView.swift
        Stream/
          ReadOnlyStreamView.swift
      SharedUI/
        DesignTokens.swift
      Resources/
        Info.plist
    Packages/
      CommandRelayKit/
        Package.swift
        Sources/
          CoreKit/
            Models/
              RelayEndpoint.swift
          RelayProtocolKit/
            Envelope/
              RelayEnvelope.swift
          TransportKit/
            Interfaces/
              RelayTransportClient.swift
          SessionDomainKit/
            Auth/
              AuthInterfaces.swift
            Sessions/
              SessionListInterfaces.swift
            Stream/
              ReadOnlyStreamInterfaces.swift
        Tests/
          CoreKitTests/
            CoreKitTests.swift
```

## Exact Next Commands

Run these from macOS with Xcode installed.

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/CommandRelay
brew install xcodegen
xcodegen generate
open CommandRelay.xcodeproj
```

After opening Xcode once and selecting a development team, run:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/CommandRelay
xcodebuild -project CommandRelay.xcodeproj -scheme CommandRelay -destination 'generic/platform=iOS Simulator' build
```

Validate package-layer interfaces independently:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/CommandRelay/Packages/CommandRelayKit
swift test
```

## Incremental Build Plan

1. Replace stub services in `AppDependencies.swift` with repository-backed implementations.
2. Add real WebSocket implementation in `TransportKit` (`RelayTransportClient`).
3. Map gateway DTOs into `SessionDomainKit` models.
4. Replace sample pairing inputs in `AuthGateViewModel` with QR scanner flow.
5. Persist replay cursors and wire reconnect logic for stream resume.
