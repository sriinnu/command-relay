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

    private let reconnectInitialDelayNs: UInt64 = 300_000_000
    private let reconnectMaxDelayNs: UInt64 = 8_000_000_000

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

        let paneID = request.sessionID
        let initialConnection = try await connectAndAttachSocket(
            paneID: paneID,
            resumeSequence: request.cursor?.lastSequence
        )
        activeSocket = initialConnection.socket
        activePaneID = paneID

        let initialState = prepareBufferedOutput(
            initialConnection.bufferedOutput,
            baselineSequence: request.cursor?.lastSequence
        )

        return AsyncThrowingStream<OutputChunk, Error> { continuation in
            initialState.chunks.forEach { continuation.yield($0) }

            let receiverTask = Task { [weak self] in
                await self?.consumeOutputLoop(
                    socket: initialConnection.socket,
                    paneID: paneID,
                    continuation: continuation,
                    lastSequence: initialState.lastSequence
                )
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

    private func connectAndAttachSocket(
        paneID: String,
        resumeSequence: Int64?
    ) async throws -> (socket: URLSessionWebSocketTask, bufferedOutput: [OutputChunk]) {
        let socket = urlSession.webSocketTask(with: configuration.webSocketURL)
        socket.resume()

        do {
            try await authenticate(socket)
            let bufferedOutput = try await attachAndBufferInitialOutput(
                socket: socket,
                paneID: paneID,
                resumeSequence: resumeSequence
            )
            return (socket: socket, bufferedOutput: bufferedOutput)
        } catch {
            socket.cancel(with: .abnormalClosure, reason: nil)
            throw error
        }
    }

    private func attachAndBufferInitialOutput(
        socket: URLSessionWebSocketTask,
        paneID: String,
        resumeSequence: Int64?
    ) async throws -> [OutputChunk] {
        let requestId = nextRequestID(prefix: "attach")
        var payload: [String: Any] = ["paneId": paneID]
        if let resumeSequence {
            payload["lastSeq"] = resumeSequence
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
            if envelope.type == "output", let chunk = parseOutputChunk(from: envelope, paneID: paneID) {
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
        continuation: AsyncThrowingStream<OutputChunk, Error>.Continuation,
        lastSequence: Int64?
    ) async {
        var currentSocket = socket
        var resumeSequence = lastSequence

        while !Task.isCancelled {
            do {
                while !Task.isCancelled {
                    let envelope = try BridgeGatewayProtocol.decode(try await currentSocket.receive())
                    if envelope.type == "output", let chunk = parseOutputChunk(from: envelope, paneID: paneID) {
                        if shouldEmit(chunk, after: resumeSequence) {
                            if chunk.sequence > 0 {
                                resumeSequence = chunk.sequence
                            }
                            continuation.yield(chunk)
                        }
                        continue
                    }

                    if envelope.type == "error" {
                        let code = BridgeGatewayProtocol.payloadString("code", in: envelope) ?? "stream_failed"
                        continuation.finish(throwing: BridgeGatewayError.requestRejected(code: code))
                        await terminateActiveConnection(closeCode: .abnormalClosure)
                        return
                    }
                }
            } catch is CancellationError {
                break
            } catch {
                if Task.isCancelled || activePaneID != paneID {
                    break
                }

                currentSocket.cancel(with: .abnormalClosure, reason: nil)
                do {
                    let reconnected = try await reconnectWithBackoff(
                        paneID: paneID,
                        resumeSequence: resumeSequence
                    )
                    if Task.isCancelled || activePaneID != paneID {
                        reconnected.socket.cancel(with: .goingAway, reason: nil)
                        break
                    }

                    currentSocket = reconnected.socket
                    activeSocket = reconnected.socket

                    for chunk in reconnected.bufferedOutput where shouldEmit(chunk, after: resumeSequence) {
                        if chunk.sequence > 0 {
                            resumeSequence = chunk.sequence
                        }
                        continuation.yield(chunk)
                    }
                } catch is CancellationError {
                    break
                } catch {
                    continuation.finish(throwing: error)
                    await terminateActiveConnection(closeCode: .abnormalClosure)
                    return
                }
            }
        }
    }

    private func reconnectWithBackoff(
        paneID: String,
        resumeSequence: Int64?
    ) async throws -> (socket: URLSessionWebSocketTask, bufferedOutput: [OutputChunk]) {
        var delayNs = reconnectInitialDelayNs

        while !Task.isCancelled {
            try Task.checkCancellation()
            do {
                let connected = try await connectAndAttachSocket(
                    paneID: paneID,
                    resumeSequence: resumeSequence
                )
                if activePaneID != paneID {
                    connected.socket.cancel(with: .goingAway, reason: nil)
                    throw CancellationError()
                }
                return connected
            } catch {
                if !isRetryableReconnectError(error) {
                    throw error
                }

                // Deterministic exponential backoff without jitter keeps retry timing predictable.
                try await Task.sleep(nanoseconds: delayNs)
                delayNs = min(delayNs * 2, reconnectMaxDelayNs)
            }
        }

        throw CancellationError()
    }

    private func isRetryableReconnectError(_ error: Error) -> Bool {
        if error is CancellationError {
            return false
        }

        guard let bridgeError = error as? BridgeGatewayError else {
            return true
        }

        switch bridgeError {
        case .requestTimedOut:
            return true
        case .invalidEnvelope, .unsupportedMessageFrame, .missingField,
             .authRejected, .requestRejected, .streamNotAttached:
            return false
        }
    }

    private func prepareBufferedOutput(
        _ chunks: [OutputChunk],
        baselineSequence: Int64?
    ) -> (chunks: [OutputChunk], lastSequence: Int64?) {
        var filtered: [OutputChunk] = []
        filtered.reserveCapacity(chunks.count)

        var latestSequence = baselineSequence
        for chunk in chunks where shouldEmit(chunk, after: latestSequence) {
            if chunk.sequence > 0 {
                latestSequence = chunk.sequence
            }
            filtered.append(chunk)
        }
        return (chunks: filtered, lastSequence: latestSequence)
    }

    private func shouldEmit(_ chunk: OutputChunk, after lastSequence: Int64?) -> Bool {
        guard chunk.sequence > 0, let lastSequence else {
            return true
        }
        return chunk.sequence > lastSequence
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
