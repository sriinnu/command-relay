import Foundation

/// Request metadata used to reconnect and replay from a known stream cursor.
public struct M0ResumeRequest: Codable, Equatable, Sendable {
    /// Identifier of the stream that should be resumed.
    public let streamID: String

    /// Sender sequence value for the reconnect request itself.
    public let streamSeq: UInt64

    /// Last sequence already processed by the reconnecting client.
    public let lastSeq: UInt64

    /// Creates a resume request.
    /// - Parameters:
    ///   - streamID: Stream identifier to resume.
    ///   - streamSeq: Sequence assigned to the reconnect request.
    ///   - lastSeq: Last processed event sequence.
    public init(streamID: String, streamSeq: UInt64, lastSeq: UInt64) {
        self.streamID = streamID
        self.streamSeq = streamSeq
        self.lastSeq = lastSeq
    }

    private enum CodingKeys: String, CodingKey {
        case streamID = "stream_id"
        case streamSeq = "stream_seq"
        case lastSeq = "last_seq"
    }
}
