import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import SessionDomainKit

/// Read-only stream service backed by live bridge WebSocket envelopes.
actor BridgeWebSocketReadOnlyStreamService: ReadOnlyStreamServicing {
    private let configuration: BridgeGatewayConfiguration
    private let urlSession: URLSession
    private var requestCounter: UInt64 = 0

    private var activePaneID: String?
    private var activeSocket: URLSessionWebSocketTask?
    private var activeReceiverTask: Task<Void, Never>?
    private var activeContinuation: AsyncThrowingStream<OutputChunk, Error>.Continuation?
    private var isTerminating = false

    /// Creates a gateway-backed read-only stream service.
    /// - Parameters:
    ///   - configuration: Gateway URL/token configuration.
    ///   - urlSession: URLSession used for websocket tasks.
    init(configuration: BridgeGatewayConfiguration, urlSession: URLSession = .shared) {
        self.configuration = configuration
        self.urlSession = urlSession
    }

    /// Attaches to one pane and yields replay/live output chunks.
    /// - Parameter request: Attach request where `sessionID` maps to gateway `paneId`.
    /// - Returns: Async stream of output chunks.
    func attach(request: StreamAttachRequest) async throws -> AsyncThrowingStream<OutputChunk, Error> {
        await terminateActiveConnection(closeCode: .normalClosure)

        let socket = urlSession.webSocketTask(with: configuration.webSocketURL)
        socket.resume()
        activeSocket = socket
        activePaneID = request.sessionID

        try await authenticate(socket)
        let bufferedOutput = try await attachAndBufferInitialOutput(socket: socket, request: request)

        let paneID = request.sessionID
        return AsyncThrowingStream<OutputChunk, Error> { continuation in
            bufferedOutput.forEach { continuation.yield($0) }

            let receiverTask = Task { [weak self] in
                await self?.consumeOutputLoop(socket: socket, paneID: paneID, continuation: continuation)
            }

            Task { [weak self] in
                await self?.storeRuntime(continuation: continuation, receiverTask: receiverTask)
            }

            continuation.onTermination = { [weak self] _ in
                receiverTask.cancel()
                Task { await self?.terminateActiveConnection(closeCode: .normalClosure) }
            }
        }
    }

    /// Detaches the currently attached stream and closes the websocket task.
    /// - Parameter sessionID: Active session/pane identifier.
    func detach(sessionID: String) async {
        guard activePaneID == sessionID else { return }
        await terminateActiveConnection(closeCode: .goingAway)
    }

    private func storeRuntime(
        continuation: AsyncThrowingStream<OutputChunk, Error>.Continuation,
        receiverTask: Task<Void, Never>
    ) {
        activeContinuation = continuation
        activeReceiverTask = receiverTask
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

    private func attachAndBufferInitialOutput(
        socket: URLSessionWebSocketTask,
        request: StreamAttachRequest
    ) async throws -> [OutputChunk] {
        let requestId = nextRequestID(prefix: "attach")
        var payload: [String: Any] = ["paneId": request.sessionID]
        if let cursor = request.cursor {
            payload["lastSeq"] = cursor.lastSequence
        }

        let attachRequest = try BridgeGatewayProtocol.encodeClientRequest(
            type: "attach",
            requestId: requestId,
            payload: payload
        )
        try await socket.send(attachRequest)

        var buffered: [OutputChunk] = []
        let deadline = Date().addingTimeInterval(TimeInterval(configuration.requestTimeoutMs) / 1000)
        while Date() < deadline {
            let envelope = try BridgeGatewayProtocol.decode(try await socket.receive())
            if envelope.type == "output", let chunk = parseOutputChunk(from: envelope, paneID: request.sessionID) {
                buffered.append(chunk)
                continue
            }

            if envelope.requestId == requestId {
                if envelope.type == "ack",
                   BridgeGatewayProtocol.payloadString("action", in: envelope) == "attach" {
                    return buffered
                }

                if envelope.type == "error" {
                    let code = BridgeGatewayProtocol.payloadString("code", in: envelope) ?? "attach_failed"
                    throw BridgeGatewayError.requestRejected(code: code)
                }
            }
        }

        throw BridgeGatewayError.requestTimedOut(type: "attach", requestId: requestId)
    }

    private func consumeOutputLoop(
        socket: URLSessionWebSocketTask,
        paneID: String,
        continuation: AsyncThrowingStream<OutputChunk, Error>.Continuation
    ) async {
        do {
            while !Task.isCancelled {
                let envelope = try BridgeGatewayProtocol.decode(try await socket.receive())
                if envelope.type == "output", let chunk = parseOutputChunk(from: envelope, paneID: paneID) {
                    continuation.yield(chunk)
                    continue
                }

                if envelope.type == "error" {
                    let code = BridgeGatewayProtocol.payloadString("code", in: envelope) ?? "stream_failed"
                    continuation.finish(throwing: BridgeGatewayError.requestRejected(code: code))
                    await terminateActiveConnection(closeCode: .abnormalClosure)
                    return
                }
            }
        } catch {
            continuation.finish(throwing: error)
            await terminateActiveConnection(closeCode: .abnormalClosure)
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

    private func parseOutputChunk(from envelope: BridgeGatewayEnvelope, paneID: String) -> OutputChunk? {
        guard BridgeGatewayProtocol.payloadString("paneId", in: envelope) == paneID else {
            return nil
        }

        let modeRaw = BridgeGatewayProtocol.payloadString("mode", in: envelope) ?? "delta"
        let mode: OutputChunkMode = modeRaw == "snapshot" ? .snapshot : .delta
        let sequence = BridgeGatewayProtocol.payloadInt64("streamSeq", in: envelope) ?? 0
        let text = (envelope.payload["chunk"] as? String) ?? ""
        return OutputChunk(mode: mode, sequence: sequence, text: text)
    }

    private func terminateActiveConnection(closeCode: URLSessionWebSocketTask.CloseCode) async {
        if isTerminating {
            return
        }
        isTerminating = true

        let socket = activeSocket
        let paneID = activePaneID
        if let socket, let paneID {
            let requestId = nextRequestID(prefix: "detach")
            let payload: [String: Any] = ["paneId": paneID]
            if let request = try? BridgeGatewayProtocol.encodeClientRequest(
                type: "detach",
                requestId: requestId,
                payload: payload
            ) {
                try? await socket.send(request)
            }
        }

        activeReceiverTask?.cancel()
        activeReceiverTask = nil

        let continuation = activeContinuation
        activeContinuation = nil
        continuation?.finish()

        activePaneID = nil
        activeSocket?.cancel(with: closeCode, reason: nil)
        activeSocket = nil
        isTerminating = false
    }

    private func nextRequestID(prefix: String) -> String {
        requestCounter += 1
        return "\(prefix)-\(requestCounter)"
    }
}
