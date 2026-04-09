import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import SessionDomainKit

/// Controlled input service backed by a dedicated bridge WebSocket session.
actor BridgeWebSocketControlledInputService: ControlledInputServicing {
    private static let ownershipOverrideReasonMarkers: [String] = [
        "ownership_override",
        "ownership-override",
        "force_ownership_override",
        "force-ownership-override"
    ]

    private let configuration: BridgeGatewayConfiguration
    private let urlSession: URLSession
    private let defaultOwnershipOverrideEnabled: Bool
    private var requestCounter: UInt64 = 0

    private var activePaneID: String?
    private var activeSocket: URLSessionWebSocketTask?
    private var policySnapshot = PolicySnapshot(inputEnabled: false, globalInputDisabled: false)
    private var sessionOwnershipOverrideRequested = false

    /// Creates a gateway-backed controlled input service.
    /// - Parameters:
    ///   - configuration: Gateway URL/token configuration.
    ///   - urlSession: URLSession used for websocket tasks.
    ///   - defaultOwnershipOverrideEnabled: Enables ownership-conflict override retries by default.
    init(
        configuration: BridgeGatewayConfiguration,
        urlSession: URLSession = .shared,
        defaultOwnershipOverrideEnabled: Bool = false
    ) {
        self.configuration = configuration
        self.urlSession = urlSession
        self.defaultOwnershipOverrideEnabled = defaultOwnershipOverrideEnabled
    }

    /// Enables controlled input for a pane/session.
    /// - Parameter request: Enable-input request payload.
    /// - Returns: Updated input control state.
    func enableInput(request: EnableInputRequest) async throws -> InputControlState {
        try validateSessionID(request.sessionID)
        let socket = try await ensureAttachedSocket(for: request.sessionID)
        if reasonRequestsOwnershipOverride(request.reason) {
            sessionOwnershipOverrideRequested = true
        }

        let requestId = nextRequestID(prefix: "enable")
        let envelope = try BridgeGatewayProtocol.encodeClientRequest(
            type: "enable_input",
            requestId: requestId,
            payload: [:]
        )
        try await socket.send(envelope)

        let response = try await waitForReply(
            socket,
            expectedTypes: Set(["policy_update", "error"]),
            requestId: requestId
        )
        let snapshot = try parsePolicyResponse(response, fallbackCode: "enable_input_failed")
        policySnapshot = snapshot
        return makeControlState(
            sessionID: request.sessionID,
            actor: request.actor,
            action: .enableInput,
            reason: request.reason,
            snapshot: snapshot
        )
    }

    /// Disables controlled input for a pane/session.
    /// - Parameter request: Disable-input request payload.
    /// - Returns: Updated input control state.
    func disableInput(request: DisableInputRequest) async throws -> InputControlState {
        try validateSessionID(request.sessionID)
        sessionOwnershipOverrideRequested = false

        guard let socket = activeSocket, activePaneID == request.sessionID else {
            return makeControlState(
                sessionID: request.sessionID,
                actor: request.actor,
                action: .disableInput,
                reason: request.reason,
                snapshot: policySnapshot.readOnlyCopy()
            )
        }

        let requestId = nextRequestID(prefix: "disable")
        let envelope = try BridgeGatewayProtocol.encodeClientRequest(
            type: "disable_input",
            requestId: requestId,
            payload: [:]
        )
        try await socket.send(envelope)

        let response = try await waitForReply(
            socket,
            expectedTypes: Set(["policy_update", "error"]),
            requestId: requestId
        )
        let snapshot = try parsePolicyResponse(response, fallbackCode: "disable_input_failed")
        policySnapshot = snapshot
        return makeControlState(
            sessionID: request.sessionID,
            actor: request.actor,
            action: .disableInput,
            reason: request.reason,
            snapshot: snapshot
        )
    }

    /// Sends one command payload to the active pane/session.
    /// - Parameter request: Send-input request payload.
    /// - Returns: Audit record for the send operation.
    func sendInput(request: SendInputRequest) async throws -> InputAuditRecord {
        try validateSessionID(request.sessionID)
        let payloadBytes = request.payload.utf8ByteCount
        guard payloadBytes > 0 else {
            throw BridgeGatewayError.missingField(name: "data")
        }

        let socket = try await ensureAttachedSocket(for: request.sessionID)
        guard !policySnapshot.globalInputDisabled else {
            throw BridgeGatewayError.requestRejected(code: "input_disabled")
        }
        let shouldAttemptOverride = shouldAttemptOwnershipOverride
        guard policySnapshot.inputEnabled || shouldAttemptOverride else {
            throw BridgeGatewayError.requestRejected(code: "input_disabled")
        }
        let wasInputEnabledAtSendStart = policySnapshot.inputEnabled
        let baseRequestID = nextRequestID(prefix: shouldAttemptOverride && !policySnapshot.inputEnabled ? "input_override" : "input")
        var response = try await sendInputEnvelope(
            socket: socket,
            requestId: baseRequestID,
            sessionID: request.sessionID,
            data: request.payload.text,
            useOwnershipOverride: shouldAttemptOverride && !policySnapshot.inputEnabled
        )

        if response.type == "error" {
            let code = BridgeGatewayProtocol.normalizedErrorCode(in: response, fallback: "input_failed")
            if BridgeGatewayProtocol.isOwnershipConflictCode(code) {
                // Keep local gate read-only once ownership is disputed until explicit re-enable.
                policySnapshot = policySnapshot.readOnlyCopy()
            }

            if BridgeGatewayProtocol.isOwnershipConflictCode(code) && shouldAttemptOverride && wasInputEnabledAtSendStart {
                let overrideRequestID = nextRequestID(prefix: "input_override")
                response = try await sendInputEnvelope(
                    socket: socket,
                    requestId: overrideRequestID,
                    sessionID: request.sessionID,
                    data: request.payload.text,
                    useOwnershipOverride: true
                )
            }
        }

        if response.type == "error" {
            let code = BridgeGatewayProtocol.normalizedErrorCode(in: response, fallback: "input_failed")
            throw BridgeGatewayError.requestRejected(code: code)
        }
        guard BridgeGatewayProtocol.payloadString("action", in: response) == "input" else {
            throw BridgeGatewayError.invalidEnvelope
        }

        let reason = "bytes=\(BridgeGatewayProtocol.payloadInt64("bytes", in: response) ?? Int64(payloadBytes))"
        return makeAuditRecord(
            sessionID: request.sessionID,
            actor: request.actor,
            action: .sendInput,
            reason: reason
        )
    }

    private func validateSessionID(_ sessionID: String) throws {
        if sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw BridgeGatewayError.missingField(name: "sessionID")
        }
    }

    private func ensureAttachedSocket(for sessionID: String) async throws -> URLSessionWebSocketTask {
        if let socket = activeSocket, activePaneID == sessionID {
            return socket
        }
        let shouldResetOverrideForSessionSwitch = activePaneID != nil && activePaneID != sessionID

        await terminateConnection(closeCode: .goingAway)

        let socket = urlSession.webSocketTask(with: configuration.webSocketURL)
        socket.resume()
        do {
            try await authenticate(socket)
            try await attach(socket: socket, sessionID: sessionID)
        } catch {
            socket.cancel(with: .abnormalClosure, reason: nil)
            throw error
        }

        activeSocket = socket
        activePaneID = sessionID
        policySnapshot = policySnapshot.readOnlyCopy()
        if shouldResetOverrideForSessionSwitch {
            sessionOwnershipOverrideRequested = false
        }
        return socket
    }

    private func sendInputEnvelope(
        socket: URLSessionWebSocketTask,
        requestId: String,
        sessionID: String,
        data: String,
        useOwnershipOverride: Bool
    ) async throws -> BridgeGatewayEnvelope {
        var payload: [String: Any] = [
            "paneId": sessionID,
            "data": data
        ]

        if useOwnershipOverride {
            // Send dual keys for forward compatibility across gateway variants.
            payload["override"] = true
            payload["takeOwnership"] = true
            payload["ownershipOverride"] = true
            payload["forceOwnership"] = true
            payload["reason"] = "ios_ownership_override"
        }

        let envelope = try BridgeGatewayProtocol.encodeClientRequest(
            type: "input",
            requestId: requestId,
            payload: payload
        )
        try await socket.send(envelope)

        return try await waitForReply(
            socket,
            expectedTypes: Set(["ack", "error"]),
            requestId: requestId
        )
    }

    private func authenticate(_ socket: URLSessionWebSocketTask) async throws {
        let requestId = nextRequestID(prefix: "auth")
        let authRequest = try BridgeGatewayProtocol.encodeClientRequest(
            type: "auth",
            requestId: requestId,
            payload: ["token": configuration.authToken ?? ""]
        )
        try await socket.send(authRequest)

        let response = try await waitForReply(
            socket,
            expectedTypes: Set(["auth_ok", "auth_error", "error"]),
            requestId: requestId
        )
        if response.type == "auth_ok" {
            return
        }
        let code = BridgeGatewayProtocol.payloadString("code", in: response) ?? "auth_failed"
        throw BridgeGatewayError.authRejected(code: code)
    }

    private func attach(socket: URLSessionWebSocketTask, sessionID: String) async throws {
        let requestId = nextRequestID(prefix: "attach")
        let request = try BridgeGatewayProtocol.encodeClientRequest(
            type: "attach",
            requestId: requestId,
            payload: ["paneId": sessionID]
        )
        try await socket.send(request)

        let response = try await waitForReply(
            socket,
            expectedTypes: Set(["ack", "error"]),
            requestId: requestId
        )
        if response.type == "error" {
            let code = BridgeGatewayProtocol.payloadString("code", in: response) ?? "attach_failed"
            throw BridgeGatewayError.requestRejected(code: code)
        }
        guard BridgeGatewayProtocol.payloadString("action", in: response) == "attach" else {
            throw BridgeGatewayError.invalidEnvelope
        }
    }

    private func parsePolicyResponse(
        _ envelope: BridgeGatewayEnvelope,
        fallbackCode: String
    ) throws -> PolicySnapshot {
        if envelope.type == "error" {
            let code = BridgeGatewayProtocol.normalizedErrorCode(in: envelope, fallback: fallbackCode)
            if BridgeGatewayProtocol.isOwnershipConflictCode(code) {
                // Ownership conflicts should force a safe local read-only state.
                let globalInputDisabled = BridgeGatewayProtocol.payloadBool("globalInputDisabled", in: envelope)
                    ?? policySnapshot.globalInputDisabled
                policySnapshot = PolicySnapshot(inputEnabled: false, globalInputDisabled: globalInputDisabled)
            }
            throw BridgeGatewayError.requestRejected(code: code)
        }
        guard envelope.type == "policy_update" else {
            throw BridgeGatewayError.invalidEnvelope
        }
        guard let inputEnabled = BridgeGatewayProtocol.payloadBool("inputEnabled", in: envelope) else {
            throw BridgeGatewayError.missingField(name: "inputEnabled")
        }
        guard let globalInputDisabled = BridgeGatewayProtocol.payloadBool("globalInputDisabled", in: envelope) else {
            throw BridgeGatewayError.missingField(name: "globalInputDisabled")
        }
        return PolicySnapshot(inputEnabled: inputEnabled, globalInputDisabled: globalInputDisabled)
    }

    private func makeControlState(
        sessionID: String,
        actor: InputAuditActor,
        action: InputAuditAction,
        reason: String?,
        snapshot: PolicySnapshot
    ) -> InputControlState {
        let mode: InputControlMode = snapshot.inputEnabled && !snapshot.globalInputDisabled ? .enabled : .readOnly
        let occurredAt = Date()
        return InputControlState(
            sessionID: sessionID,
            mode: mode,
            globalInputDisabled: snapshot.globalInputDisabled,
            updatedAt: occurredAt,
            auditRecord: makeAuditRecord(
                sessionID: sessionID,
                actor: actor,
                action: action,
                reason: reason,
                occurredAt: occurredAt
            )
        )
    }

    private func makeAuditRecord(
        sessionID: String,
        actor: InputAuditActor,
        action: InputAuditAction,
        reason: String?,
        occurredAt: Date = Date()
    ) -> InputAuditRecord {
        InputAuditRecord(
            id: UUID().uuidString,
            sessionID: sessionID,
            action: action,
            actor: actor,
            occurredAt: occurredAt,
            reason: reason
        )
    }

    private func waitForReply(
        _ socket: URLSessionWebSocketTask,
        expectedTypes: Set<String>,
        requestId: String
    ) async throws -> BridgeGatewayEnvelope {
        let deadline = Date().addingTimeInterval(TimeInterval(configuration.requestTimeoutMs) / 1000)
        while Date() < deadline {
            let envelope = try BridgeGatewayProtocol.decode(try await socket.receive())
            if envelope.requestId == requestId && expectedTypes.contains(envelope.type) {
                return envelope
            }
        }
        throw BridgeGatewayError.requestTimedOut(type: "request", requestId: requestId)
    }

    private func terminateConnection(closeCode: URLSessionWebSocketTask.CloseCode) async {
        activePaneID = nil
        activeSocket?.cancel(with: closeCode, reason: nil)
        activeSocket = nil
    }

    private var shouldAttemptOwnershipOverride: Bool {
        defaultOwnershipOverrideEnabled || sessionOwnershipOverrideRequested
    }

    private func reasonRequestsOwnershipOverride(_ reason: String?) -> Bool {
        guard let rawReason = reason?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawReason.isEmpty else {
            return false
        }

        let normalized = rawReason.lowercased()
        return Self.ownershipOverrideReasonMarkers.contains { marker in
            normalized.contains(marker)
        }
    }

    private func nextRequestID(prefix: String) -> String {
        requestCounter += 1
        return "\(prefix)-\(requestCounter)"
    }
}

private struct PolicySnapshot: Sendable, Equatable {
    let inputEnabled: Bool
    let globalInputDisabled: Bool

    func readOnlyCopy() -> PolicySnapshot {
        PolicySnapshot(inputEnabled: false, globalInputDisabled: globalInputDisabled)
    }
}
