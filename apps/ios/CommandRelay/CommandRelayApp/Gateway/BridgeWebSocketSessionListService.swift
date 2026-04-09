import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import SessionDomainKit

/// Read-only session list service backed by the bridge WebSocket protocol.
actor BridgeWebSocketSessionListService: SessionListServicing {
    private let configuration: BridgeGatewayConfiguration
    private let urlSession: URLSession
    private var requestCounter: UInt64 = 0

    /// Creates a gateway-backed session list service.
    /// - Parameters:
    ///   - configuration: Gateway URL/token configuration.
    ///   - urlSession: URLSession used for websocket tasks.
    init(configuration: BridgeGatewayConfiguration, urlSession: URLSession = .shared) {
        self.configuration = configuration
        self.urlSession = urlSession
    }

    /// Lists active tmux panes via `list_sessions` and maps them to UI session rows.
    /// - Parameter query: Query options used for local filtering.
    /// - Returns: Session summaries derived from live gateway payloads.
    func listSessions(query: SessionListQuery) async throws -> [RelaySessionSummary] {
        let socket = urlSession.webSocketTask(with: configuration.webSocketURL)
        socket.resume()
        defer { socket.cancel(with: .normalClosure, reason: nil) }

        try await authenticate(socket)
        let requestId = nextRequestID(prefix: "list")
        let listRequest = try BridgeGatewayProtocol.encodeClientRequest(
            type: "list_sessions",
            requestId: requestId,
            payload: [:]
        )
        try await socket.send(listRequest)

        let response = try await waitForReply(
            socket,
            expectedTypes: Set(["session_list", "error"]),
            requestId: requestId
        )
        if response.type == "error" {
            let code = BridgeGatewayProtocol.payloadString("code", in: response) ?? "unknown_error"
            throw BridgeGatewayError.requestRejected(code: code)
        }

        let sessions = parseSessionSummaries(from: response)
        if query.searchText.isEmpty {
            return sessions
        }

        return sessions.filter { summary in
            summary.title.localizedCaseInsensitiveContains(query.searchText)
                || summary.id.localizedCaseInsensitiveContains(query.searchText)
                || summary.host.localizedCaseInsensitiveContains(query.searchText)
        }
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

        switch response.type {
        case "auth_ok":
            return
        case "auth_error", "error":
            let code = BridgeGatewayProtocol.payloadString("code", in: response) ?? "auth_failed"
            throw BridgeGatewayError.authRejected(code: code)
        default:
            throw BridgeGatewayError.invalidEnvelope
        }
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

    private func parseSessionSummaries(from envelope: BridgeGatewayEnvelope) -> [RelaySessionSummary] {
        let panePayload = envelope.payload["panes"] as? [[String: Any]] ?? []
        let paneSummaries = panePayload.compactMap { pane -> RelaySessionSummary? in
            guard let paneId = pane["paneId"] as? String else {
                return nil
            }
            let sessionName = (pane["sessionName"] as? String) ?? "session"
            let windowName = (pane["windowName"] as? String) ?? "pane"
            let title = "\(sessionName) / \(windowName)"
            return RelaySessionSummary(id: paneId, title: title, host: sessionName, readOnly: true)
        }
        if !paneSummaries.isEmpty {
            return paneSummaries
        }

        // Fallback path for compact payloads where only grouped sessions are present.
        let groupedPayload = envelope.payload["sessions"] as? [[String: Any]] ?? []
        return groupedPayload.compactMap { session in
            guard let sessionName = session["sessionName"] as? String,
                  let paneIDs = session["paneIds"] as? [String],
                  let firstPaneID = paneIDs.first else {
                return nil
            }
            return RelaySessionSummary(id: firstPaneID, title: sessionName, host: sessionName, readOnly: true)
        }
    }

    private func nextRequestID(prefix: String) -> String {
        requestCounter += 1
        return "\(prefix)-\(requestCounter)"
    }
}
