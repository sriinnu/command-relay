import Foundation

/// All M0 event variants supported by the mock client.
public enum M0Event: Codable, Equatable, Sendable {
    /// Stream connection lifecycle event.
    case connected(M0ConnectedEvent)

    /// Terminal or process output chunk.
    case outputChunk(M0OutputChunkEvent)

    /// Generic status transition event.
    case status(M0StatusEvent)

    /// Liveness pulse event.
    case heartbeat(M0HeartbeatEvent)

    private enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    private enum EventType: String, Codable {
        case connected
        case outputChunk = "output_chunk"
        case status
        case heartbeat
    }

    /// Decodes a typed M0 event from a discriminator-based payload format.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(EventType.self, forKey: .type)

        switch type {
        case .connected:
            self = .connected(try container.decode(M0ConnectedEvent.self, forKey: .payload))
        case .outputChunk:
            self = .outputChunk(try container.decode(M0OutputChunkEvent.self, forKey: .payload))
        case .status:
            self = .status(try container.decode(M0StatusEvent.self, forKey: .payload))
        case .heartbeat:
            self = .heartbeat(try container.decode(M0HeartbeatEvent.self, forKey: .payload))
        }
    }

    /// Encodes a typed M0 event into a discriminator-based payload format.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .connected(event):
            try container.encode(EventType.connected, forKey: .type)
            try container.encode(event, forKey: .payload)
        case let .outputChunk(event):
            try container.encode(EventType.outputChunk, forKey: .type)
            try container.encode(event, forKey: .payload)
        case let .status(event):
            try container.encode(EventType.status, forKey: .type)
            try container.encode(event, forKey: .payload)
        case let .heartbeat(event):
            try container.encode(EventType.heartbeat, forKey: .type)
            try container.encode(event, forKey: .payload)
        }
    }
}

/// Payload for a connection lifecycle event.
public struct M0ConnectedEvent: Codable, Equatable, Sendable {
    /// Server session identifier.
    public let sessionID: String

    /// Last sequence accepted by the server for replay resume.
    public let acceptedLastSeq: UInt64?

    /// Creates a connected event payload.
    /// - Parameters:
    ///   - sessionID: Server session identifier.
    ///   - acceptedLastSeq: Last sequence accepted by server.
    public init(sessionID: String, acceptedLastSeq: UInt64?) {
        self.sessionID = sessionID
        self.acceptedLastSeq = acceptedLastSeq
    }

    private enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case acceptedLastSeq = "accepted_last_seq"
    }
}

/// Payload containing stream output data.
public struct M0OutputChunkEvent: Codable, Equatable, Sendable {
    /// Text chunk emitted by the stream.
    public let chunk: String

    /// Marks whether this chunk ends the current output frame.
    public let isFinal: Bool

    /// Creates an output chunk payload.
    /// - Parameters:
    ///   - chunk: Stream output chunk.
    ///   - isFinal: Final chunk indicator.
    public init(chunk: String, isFinal: Bool) {
        self.chunk = chunk
        self.isFinal = isFinal
    }

    private enum CodingKeys: String, CodingKey {
        case chunk
        case isFinal = "is_final"
    }
}

/// Payload describing a status transition.
public struct M0StatusEvent: Codable, Equatable, Sendable {
    /// Machine-readable status code.
    public let code: String

    /// Human-readable status description.
    public let message: String

    /// Creates a status payload.
    /// - Parameters:
    ///   - code: Machine-readable status code.
    ///   - message: Human-readable status description.
    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

/// Payload used to indicate stream liveness.
public struct M0HeartbeatEvent: Codable, Equatable, Sendable {
    /// Server epoch timestamp in milliseconds.
    public let serverTimeMs: UInt64

    /// Creates a heartbeat payload.
    /// - Parameter serverTimeMs: Server epoch milliseconds.
    public init(serverTimeMs: UInt64) {
        self.serverTimeMs = serverTimeMs
    }

    private enum CodingKeys: String, CodingKey {
        case serverTimeMs = "server_time_ms"
    }
}
