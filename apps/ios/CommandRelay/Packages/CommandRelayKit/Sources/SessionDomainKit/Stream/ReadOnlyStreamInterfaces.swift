import Foundation

/// Output chunk emission mode from relay stream.
public enum OutputChunkMode: Sendable, Equatable {
    /// Full snapshot replacing any previous buffer.
    case snapshot

    /// Incremental append chunk.
    case delta
}

/// Replay cursor tracked per session/pane.
public struct StreamCursor: Sendable, Equatable {
    /// Last processed sequence number.
    public let lastSequence: Int64

    /// Creates a stream cursor.
    /// - Parameter lastSequence: Last processed sequence number.
    public init(lastSequence: Int64) {
        self.lastSequence = lastSequence
    }
}

/// Output payload emitted by the relay stream.
public struct OutputChunk: Sendable, Equatable {
    /// Snapshot or delta semantics for this chunk.
    public let mode: OutputChunkMode

    /// Stream sequence for dedupe and replay.
    public let sequence: Int64

    /// UTF-8 terminal bytes as decoded text.
    public let text: String

    /// Creates an output chunk.
    /// - Parameters:
    ///   - mode: Snapshot or delta semantics.
    ///   - sequence: Stream sequence.
    ///   - text: Terminal text payload.
    public init(mode: OutputChunkMode, sequence: Int64, text: String) {
        self.mode = mode
        self.sequence = sequence
        self.text = text
    }
}

/// Attach options for read-only stream sessions.
public struct StreamAttachRequest: Sendable, Equatable {
    /// Session identifier from list API.
    public let sessionID: String

    /// Optional cursor for replay resume.
    public let cursor: StreamCursor?

    /// Creates an attach request.
    /// - Parameters:
    ///   - sessionID: Session identifier.
    ///   - cursor: Optional replay cursor.
    public init(sessionID: String, cursor: StreamCursor?) {
        self.sessionID = sessionID
        self.cursor = cursor
    }
}

/// Read-only attach/replay flow for terminal streaming.
public protocol ReadOnlyStreamServicing: Sendable {
    /// Attaches to a session and starts receiving output chunks.
    /// - Parameter request: Attach options including replay cursor.
    func attach(request: StreamAttachRequest) async throws -> AsyncThrowingStream<OutputChunk, Error>

    /// Detaches from the active session stream.
    /// - Parameter sessionID: Session to detach from.
    func detach(sessionID: String) async
}
