import Foundation

/// A strongly typed M0 envelope that wraps a protocol payload and replay metadata.
public struct M0Envelope<Payload: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    /// Stable stream identifier used to group ordered events.
    public let streamID: String

    /// Monotonic sequence number for this stream event.
    public let streamSeq: UInt64

    /// Optional receiver cursor reported by the sender at emit time.
    public let lastSeq: UInt64?

    /// Unix epoch timestamp in milliseconds when the envelope was produced.
    public let sentAtMs: UInt64

    /// Typed event payload contained by this envelope.
    public let event: Payload

    /// Creates a typed M0 envelope.
    /// - Parameters:
    ///   - streamID: Unique stream identifier.
    ///   - streamSeq: Sequence number for this event.
    ///   - lastSeq: Optional last acknowledged sequence.
    ///   - sentAtMs: Epoch milliseconds for the envelope timestamp.
    ///   - event: Typed payload to carry.
    public init(
        streamID: String,
        streamSeq: UInt64,
        lastSeq: UInt64?,
        sentAtMs: UInt64,
        event: Payload
    ) {
        self.streamID = streamID
        self.streamSeq = streamSeq
        self.lastSeq = lastSeq
        self.sentAtMs = sentAtMs
        self.event = event
    }

    private enum CodingKeys: String, CodingKey {
        case streamID = "stream_id"
        case streamSeq = "stream_seq"
        case lastSeq = "last_seq"
        case sentAtMs = "sent_at_ms"
        case event
    }
}
