import Foundation

/// Supported event kinds exchanged with the relay gateway.
public enum RelayEventKind: String, Codable, Sendable {
    case auth
    case authOK = "auth_ok"
    case listSessions = "list_sessions"
    case attach
    case outputChunk = "output.chunk"
    case heartbeat
    case error
}

/// Serialized event envelope passed across transport and domain boundaries.
public struct RelayEnvelope: Codable, Sendable, Equatable {
    /// Event type.
    public let kind: RelayEventKind

    /// Sequence number used for replay and ordering.
    public let sequence: Int64

    /// Raw payload data, encoded with JSON serialization by default.
    public let payload: Data

    /// Creates an envelope.
    /// - Parameters:
    ///   - kind: Event type.
    ///   - sequence: Monotonic stream sequence.
    ///   - payload: Serialized payload bytes.
    public init(kind: RelayEventKind, sequence: Int64, payload: Data) {
        self.kind = kind
        self.sequence = sequence
        self.payload = payload
    }
}
