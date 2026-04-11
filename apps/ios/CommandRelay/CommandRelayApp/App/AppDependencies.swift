import Foundation
import SessionDomainKit

struct AppDependencies {
    let authService: any AuthSessionServicing
    let sessionsService: any SessionListServicing
    let streamService: any ReadOnlyStreamServicing
    let inputService: any ControlledInputServicing

    static func makeDefault(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> AppDependencies {
        guard let configuration = BridgeGatewayConfiguration.fromEnvironment(environment) else {
            return makeStub()
        }
        let allowOwnershipOverride = resolveTruthyFlag(
            keys: ["COMMANDRELAY_INPUT_OWNERSHIP_OVERRIDE", "COMMANDRELAY_FORCE_INPUT_OWNERSHIP_OVERRIDE"],
            environment: environment
        )

        return AppDependencies(
            authService: GatewayAuthService(configuration: configuration),
            sessionsService: BridgeWebSocketSessionListService(configuration: configuration),
            streamService: BridgeWebSocketReadOnlyStreamService(configuration: configuration),
            inputService: BridgeWebSocketControlledInputService(
                configuration: configuration,
                defaultOwnershipOverrideEnabled: allowOwnershipOverride
            )
        )
    }

    static func makeStub() -> AppDependencies {
        AppDependencies(
            authService: StubAuthService(),
            sessionsService: StubSessionListService(),
            streamService: StubReadOnlyStreamService(),
            inputService: StubControlledInputService()
        )
    }

    private static func resolveTruthyFlag(
        keys: [String],
        environment: [String: String]
    ) -> Bool {
        let truthyValues: Set<String> = ["1", "true", "yes", "on"]
        for key in keys {
            guard let rawValue = environment[key] else {
                continue
            }
            let normalized = rawValue
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            if truthyValues.contains(normalized) {
                return true
            }
        }
        return false
    }
}

actor StubAuthService: AuthSessionServicing {
    func pairDevice(using qrCode: PairingQRCode) async throws -> DeviceIdentity {
        _ = qrCode
        return DeviceIdentity(deviceID: "ios-device-001", displayName: "iPhone Dev")
    }

    func refreshAccessToken() async throws -> String {
        "stub-access-token"
    }

    func fetchCapabilities() async throws -> SessionCapabilities {
        SessionCapabilities(readOnly: true, canEnableInput: true)
    }
}

actor StubSessionListService: SessionListServicing {
    func listSessions(query: SessionListQuery) async throws -> [RelaySessionSummary] {
        let all = [
            RelaySessionSummary(id: "session-1", title: "Web API", host: "prod-web-01", readOnly: true),
            RelaySessionSummary(id: "session-2", title: "Worker", host: "prod-worker-04", readOnly: true)
        ]

        if query.searchText.isEmpty {
            return all
        }

        return all.filter { $0.title.localizedCaseInsensitiveContains(query.searchText) }
    }
}

actor StubReadOnlyStreamService: ReadOnlyStreamServicing {
    func attach(request: StreamAttachRequest) async throws -> AsyncThrowingStream<OutputChunk, Error> {
        AsyncThrowingStream { continuation in
            // Emit a tiny canned transcript so the stream feature can be iterated in UI.
            continuation.yield(
                OutputChunk(mode: .snapshot, sequence: request.cursor?.lastSequence ?? 0, text: "$ whoami\n")
            )
            continuation.yield(
                OutputChunk(
                    mode: .delta,
                    sequence: (request.cursor?.lastSequence ?? 0) + 1,
                    text: "commandrelay\n"
                )
            )
            continuation.finish()
        }
    }

    func detach(sessionID: String) async {
        _ = sessionID
    }
}

actor StubControlledInputService: ControlledInputServicing {
    private var isInputEnabled = false

    func enableInput(request: EnableInputRequest) async throws -> InputControlState {
        isInputEnabled = true
        let now = Date()
        return InputControlState(
            sessionID: request.sessionID,
            mode: .enabled,
            globalInputDisabled: false,
            updatedAt: now,
            auditRecord: InputAuditRecord(
                id: UUID().uuidString,
                sessionID: request.sessionID,
                action: .enableInput,
                actor: request.actor,
                occurredAt: now,
                reason: request.reason
            )
        )
    }

    func disableInput(request: DisableInputRequest) async throws -> InputControlState {
        isInputEnabled = false
        let now = Date()
        return InputControlState(
            sessionID: request.sessionID,
            mode: .readOnly,
            globalInputDisabled: false,
            updatedAt: now,
            auditRecord: InputAuditRecord(
                id: UUID().uuidString,
                sessionID: request.sessionID,
                action: .disableInput,
                actor: request.actor,
                occurredAt: now,
                reason: request.reason
            )
        )
    }

    func sendInput(request: SendInputRequest) async throws -> InputAuditRecord {
        guard isInputEnabled else {
            throw BridgeGatewayError.requestRejected(code: "input_disabled")
        }
        return InputAuditRecord(
            id: UUID().uuidString,
            sessionID: request.sessionID,
            action: .sendInput,
            actor: request.actor,
            occurredAt: Date(),
            reason: "bytes=\(request.payload.utf8ByteCount)"
        )
    }
}

actor GatewayAuthService: AuthSessionServicing {
    private let configuration: BridgeGatewayConfiguration

    init(configuration: BridgeGatewayConfiguration) {
        self.configuration = configuration
    }

    func pairDevice(using qrCode: PairingQRCode) async throws -> DeviceIdentity {
        _ = qrCode
        return DeviceIdentity(deviceID: "ios-live-device", displayName: "CommandRelay iOS")
    }

    func refreshAccessToken() async throws -> String {
        configuration.authToken ?? ""
    }

    func fetchCapabilities() async throws -> SessionCapabilities {
        SessionCapabilities(readOnly: true, canEnableInput: true)
    }
}
