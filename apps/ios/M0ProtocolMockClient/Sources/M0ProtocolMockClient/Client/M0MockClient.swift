import Foundation

/// Result of a mock reconnect attempt, including replay metadata and payloads.
public struct M0ReconnectResult: Equatable, Sendable {
    /// Resume metadata the client would send over transport.
    public let resumeRequest: M0ResumeRequest

    /// Replay events returned by the mock transport for this reconnect.
    public let replayEvents: [M0Envelope<M0Event>]

    /// Creates a reconnect result.
    /// - Parameters:
    ///   - resumeRequest: Resume metadata to send.
    ///   - replayEvents: Replay events to consume.
    public init(resumeRequest: M0ResumeRequest, replayEvents: [M0Envelope<M0Event>]) {
        self.resumeRequest = resumeRequest
        self.replayEvents = replayEvents
    }
}

/// In-memory M0 protocol mock transport with reconnect and replay support.
public actor M0MockClient {
    private let streamID: String
    private let planner: M0ReplayPlanner
    private let cursorStore: M0ReplayCursorStore
    private var backlog: [M0Envelope<M0Event>]
    private var nextSeq: UInt64

    /// Creates an in-memory mock client.
    /// - Parameters:
    ///   - streamID: Stream identifier managed by this mock client.
    ///   - initialEvents: Optional seed events for replay testing.
    ///   - cursorStore: Cursor store used for `lastSeq` persistence.
    ///   - planner: Replay planner used for reconnect behavior.
    public init(
        streamID: String,
        initialEvents: [M0Envelope<M0Event>] = [],
        cursorStore: M0ReplayCursorStore = M0ReplayCursorStore(),
        planner: M0ReplayPlanner = M0ReplayPlanner()
    ) {
        self.streamID = streamID
        self.planner = planner
        self.cursorStore = cursorStore
        self.backlog = initialEvents.sorted { lhs, rhs in lhs.streamSeq < rhs.streamSeq }
        self.nextSeq = (self.backlog.last?.streamSeq ?? 0) + 1
    }

    /// Appends a new event to the stream backlog.
    /// - Parameters:
    ///   - event: Typed event payload to append.
    ///   - sentAtMs: Event timestamp in epoch milliseconds.
    /// - Returns: The created typed envelope.
    @discardableResult
    public func append(event: M0Event, sentAtMs: UInt64) -> M0Envelope<M0Event> {
        let envelope = M0Envelope(
            streamID: streamID,
            streamSeq: nextSeq,
            lastSeq: nil,
            sentAtMs: sentAtMs,
            event: event
        )
        backlog.append(envelope)
        nextSeq += 1
        return envelope
    }

    /// Records that the consumer has fully processed a sequence number.
    /// - Parameter seq: Sequence acknowledged by the consumer.
    public func acknowledge(seq: UInt64) async {
        await cursorStore.record(streamID: streamID, seq: seq)
    }

    /// Performs a reconnect flow and returns replay data after the current cursor.
    /// - Returns: Resume metadata and replay events greater than `lastSeq`.
    public func reconnect() async -> M0ReconnectResult {
        let lastSeq = await cursorStore.lastSeq(for: streamID) ?? 0
        let resumeRequest = planner.makeResumeRequest(
            streamID: streamID,
            streamSeq: nextSeq,
            lastSeq: lastSeq
        )
        let replayEvents = planner.replayEvents(from: backlog, lastSeq: lastSeq)
        return M0ReconnectResult(resumeRequest: resumeRequest, replayEvents: replayEvents)
    }

    /// Exposes a sorted backlog snapshot for diagnostics and tests.
    /// - Returns: Ordered stream envelope backlog.
    public func backlogSnapshot() -> [M0Envelope<M0Event>] {
        backlog.sorted { lhs, rhs in lhs.streamSeq < rhs.streamSeq }
    }
}
