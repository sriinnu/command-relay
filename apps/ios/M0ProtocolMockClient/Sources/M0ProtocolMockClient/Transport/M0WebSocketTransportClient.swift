import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Minimal task interface required by the websocket transport client.
public protocol M0WebSocketTasking: AnyObject, Sendable {
    /// Starts the websocket task.
    func resume()

    /// Cancels the websocket task with a close code and optional reason payload.
    /// - Parameters:
    ///   - closeCode: Websocket close code.
    ///   - reason: Optional reason bytes.
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)

    /// Sends one websocket message.
    /// - Parameter message: Message to send.
    func send(_ message: URLSessionWebSocketTask.Message) async throws

    /// Receives one websocket message.
    /// - Returns: Next received message.
    func receive() async throws -> URLSessionWebSocketTask.Message
}

/// Factory used to create websocket tasks for transport connections.
public protocol M0WebSocketTaskFactory: Sendable {
    /// Creates a websocket task for a request.
    /// - Parameter request: Websocket URL request.
    /// - Returns: Configured websocket task wrapper.
    func makeTask(for request: URLRequest) -> any M0WebSocketTasking
}

/// Adapter that exposes `URLSessionWebSocketTask` through `M0WebSocketTasking`.
public final class M0URLSessionWebSocketTaskAdapter: M0WebSocketTasking, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    /// Creates an adapter around a `URLSessionWebSocketTask`.
    /// - Parameter task: Underlying URLSession websocket task.
    public init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    /// Starts the websocket task.
    public func resume() {
        task.resume()
    }

    /// Cancels the websocket task.
    /// - Parameters:
    ///   - closeCode: Websocket close code.
    ///   - reason: Optional reason payload.
    public func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        task.cancel(with: closeCode, reason: reason)
    }

    /// Sends one websocket message.
    /// - Parameter message: Message to send.
    public func send(_ message: URLSessionWebSocketTask.Message) async throws {
        try await task.send(message)
    }

    /// Receives one websocket message.
    /// - Returns: Next received message.
    public func receive() async throws -> URLSessionWebSocketTask.Message {
        try await task.receive()
    }
}

/// Default websocket task factory backed by URLSession.
public struct M0URLSessionWebSocketTaskFactory: M0WebSocketTaskFactory, @unchecked Sendable {
    private let session: URLSession

    /// Creates a URLSession-backed websocket factory.
    /// - Parameter session: URLSession used to create websocket tasks.
    public init(session: URLSession = .shared) {
        self.session = session
    }

    /// Creates a websocket task for a request.
    /// - Parameter request: Websocket URL request.
    /// - Returns: Websocket task adapter.
    public func makeTask(for request: URLRequest) -> any M0WebSocketTasking {
        M0URLSessionWebSocketTaskAdapter(task: session.webSocketTask(with: request))
    }
}

/// Lifecycle updates emitted by the websocket transport client.
public enum M0WebSocketLifecycleEvent: Equatable, Sendable {
    /// A connection attempt has started.
    case connecting

    /// A websocket connection is active.
    case connected

    /// The current websocket connection ended.
    case disconnected

    /// A frame was dropped due to decoding or mapping failure.
    case frameDropped(reason: String)

    /// A reconnect attempt was scheduled.
    case reconnectScheduled(attempt: Int, delayMs: UInt64)

    /// The client run loop stopped.
    case stopped
}

/// Errors raised by websocket transport operations.
public enum M0WebSocketTransportError: Error, Equatable, LocalizedError, Sendable {
    /// Raised when sending while there is no active websocket task.
    case notConnected

    /// Human-readable error description.
    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "WebSocket transport is not connected."
        }
    }
}

/// Actor-based websocket protocol client with reconnect, backoff, and typed decode hooks.
public actor M0WebSocketTransportClient<Payload: Codable & Equatable & Sendable, Event: Sendable> {
    /// Event callback signature for mapped protocol events.
    public typealias EventHandler = @Sendable (Event) async -> Void

    /// Lifecycle callback signature for connection state events.
    public typealias LifecycleHandler = @Sendable (M0WebSocketLifecycleEvent) async -> Void

    /// Callback that supplies an optional resume request per connect.
    public typealias ResumeRequestProvider = @Sendable () async -> M0ResumeRequest?

    /// Callback invoked after each successfully decoded envelope.
    public typealias EnvelopeAcknowledgeHandler = @Sendable (M0Envelope<Payload>) async -> Void

    typealias SleepHook = @Sendable (_ delayMs: UInt64) async throws -> Void
    typealias RandomUnitProvider = @Sendable () -> Double

    private let request: URLRequest
    private let taskFactory: any M0WebSocketTaskFactory
    private let framer: M0WebSocketFramer
    private let pipeline: M0DecodedEventPipeline<Payload, Event>
    private let reconnectPolicy: M0ReconnectBackoffPolicy
    private let resumeRequestProvider: ResumeRequestProvider?
    private let envelopeAcknowledgeHandler: EnvelopeAcknowledgeHandler?
    private let sleepHook: SleepHook
    private let randomUnitProvider: RandomUnitProvider

    private var shouldRun = false
    private var activeTask: (any M0WebSocketTasking)?

    /// Creates a websocket transport client.
    /// - Parameters:
    ///   - request: Websocket endpoint request.
    ///   - taskFactory: Factory used to create websocket tasks.
    ///   - framer: Message framing adapter.
    ///   - pipeline: Typed decode-and-map pipeline.
    ///   - reconnectPolicy: Reconnect backoff strategy.
    ///   - resumeRequestProvider: Optional callback for reconnect resume metadata.
    ///   - envelopeAcknowledgeHandler: Optional callback invoked for each decoded envelope.
    public init(
        request: URLRequest,
        taskFactory: any M0WebSocketTaskFactory = M0URLSessionWebSocketTaskFactory(),
        framer: M0WebSocketFramer = M0WebSocketFramer(),
        pipeline: M0DecodedEventPipeline<Payload, Event>,
        reconnectPolicy: M0ReconnectBackoffPolicy = M0ReconnectBackoffPolicy(),
        resumeRequestProvider: ResumeRequestProvider? = nil,
        envelopeAcknowledgeHandler: EnvelopeAcknowledgeHandler? = nil
    ) {
        self.request = request
        self.taskFactory = taskFactory
        self.framer = framer
        self.pipeline = pipeline
        self.reconnectPolicy = reconnectPolicy
        self.resumeRequestProvider = resumeRequestProvider
        self.envelopeAcknowledgeHandler = envelopeAcknowledgeHandler
        self.sleepHook = Self.defaultSleepHook
        self.randomUnitProvider = { Double.random(in: 0...1) }
    }

    init(
        request: URLRequest,
        taskFactory: any M0WebSocketTaskFactory,
        framer: M0WebSocketFramer,
        pipeline: M0DecodedEventPipeline<Payload, Event>,
        reconnectPolicy: M0ReconnectBackoffPolicy,
        resumeRequestProvider: ResumeRequestProvider?,
        envelopeAcknowledgeHandler: EnvelopeAcknowledgeHandler?,
        sleepHook: @escaping SleepHook,
        randomUnitProvider: @escaping RandomUnitProvider
    ) {
        self.request = request
        self.taskFactory = taskFactory
        self.framer = framer
        self.pipeline = pipeline
        self.reconnectPolicy = reconnectPolicy
        self.resumeRequestProvider = resumeRequestProvider
        self.envelopeAcknowledgeHandler = envelopeAcknowledgeHandler
        self.sleepHook = sleepHook
        self.randomUnitProvider = randomUnitProvider
    }

    /// Starts consuming websocket messages until `stop()` is called.
    /// - Parameters:
    ///   - eventHandler: Receives mapped typed protocol events.
    ///   - lifecycleHandler: Optional callback for lifecycle events.
    public func start(
        eventHandler: @escaping EventHandler,
        lifecycleHandler: LifecycleHandler? = nil
    ) async {
        guard !shouldRun else { return }
        shouldRun = true
        var reconnectAttempt = 0

        while shouldRun {
            await emit(.connecting, to: lifecycleHandler)

            do {
                try await consumeConnection(eventHandler: eventHandler, lifecycleHandler: lifecycleHandler)
            } catch {
                guard shouldRun else { break }
                await emit(.disconnected, to: lifecycleHandler)

                let delayMs = reconnectPolicy.delayMilliseconds(
                    forAttempt: reconnectAttempt,
                    randomUnit: randomUnitProvider()
                )
                reconnectAttempt += 1
                await emit(.reconnectScheduled(attempt: reconnectAttempt, delayMs: delayMs), to: lifecycleHandler)

                do {
                    try await sleepHook(delayMs)
                } catch {
                    break
                }
                continue
            }

            guard shouldRun else { break }
            await emit(.disconnected, to: lifecycleHandler)
            reconnectAttempt = 0
        }

        shouldRun = false
        activeTask = nil
        await emit(.stopped, to: lifecycleHandler)
    }

    /// Stops consumption and closes the active websocket connection.
    /// - Parameters:
    ///   - closeCode: Websocket close code to send.
    ///   - reason: Optional close reason payload.
    public func stop(
        closeCode: URLSessionWebSocketTask.CloseCode = .normalClosure,
        reason: Data? = nil
    ) {
        shouldRun = false
        activeTask?.cancel(with: closeCode, reason: reason)
    }

    /// Sends an encoded payload on the active websocket task.
    /// - Parameters:
    ///   - payload: Encodable payload value.
    ///   - preferTextFrames: Uses text websocket frames when payload bytes are UTF-8.
    /// - Throws: `M0WebSocketTransportError.notConnected` if no active connection exists.
    public func send<Outbound: Encodable & Sendable>(
        payload: Outbound,
        preferTextFrames: Bool = true
    ) async throws {
        guard let task = activeTask else {
            throw M0WebSocketTransportError.notConnected
        }

        let payloadData = try JSONEncoder().encode(payload)
        let message = framer.message(from: payloadData, preferTextFrames: preferTextFrames)
        try await task.send(message)
    }

    private func consumeConnection(
        eventHandler: @escaping EventHandler,
        lifecycleHandler: LifecycleHandler?
    ) async throws {
        let task = taskFactory.makeTask(for: request)
        activeTask = task
        defer { activeTask = nil }

        task.resume()
        await emit(.connected, to: lifecycleHandler)

        if let resumeRequestProvider, let resumeRequest = await resumeRequestProvider() {
            try await send(resumeRequest: resumeRequest, on: task)
        }

        while shouldRun {
            let incoming = try await task.receive()

            do {
                let frameData = try framer.data(from: incoming)
                let decoded = try pipeline.process(frameData: frameData)

                if let envelopeAcknowledgeHandler {
                    await envelopeAcknowledgeHandler(decoded.envelope)
                }

                await eventHandler(decoded.event)
            } catch let frameError as M0WebSocketFramingError {
                await emit(.frameDropped(reason: frameError.localizedDescription), to: lifecycleHandler)
            } catch let pipelineError as M0DecodedEventPipelineError {
                await emit(.frameDropped(reason: pipelineError.localizedDescription), to: lifecycleHandler)
            }
        }
    }

    private func send(
        resumeRequest: M0ResumeRequest,
        on task: any M0WebSocketTasking
    ) async throws {
        let requestData = try JSONEncoder().encode(resumeRequest)
        let message = framer.message(from: requestData, preferTextFrames: true)
        try await task.send(message)
    }

    private func emit(_ event: M0WebSocketLifecycleEvent, to handler: LifecycleHandler?) async {
        guard let handler else { return }
        await handler(event)
    }

    private static func defaultSleepHook(delayMs: UInt64) async throws {
        let (nanoseconds, overflow) = delayMs.multipliedReportingOverflow(by: 1_000_000)
        try await Task.sleep(nanoseconds: overflow ? UInt64.max : nanoseconds)
    }
}
