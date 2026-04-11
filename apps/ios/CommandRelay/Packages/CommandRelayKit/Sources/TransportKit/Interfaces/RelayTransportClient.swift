import CoreKit
import Foundation
import RelayProtocolKit

/// Minimal transport state machine surface exposed to higher layers.
public enum RelayTransportState: Sendable, Equatable {
    case idle
    case connecting
    case connected
    case reconnecting
    case disconnected
}

/// Actor-friendly WebSocket abstraction used by domain and repositories.
public protocol RelayTransportClient: Sendable {
    /// Current transport state stream.
    var state: AsyncStream<RelayTransportState> { get }

    /// Opens the relay connection.
    /// - Parameter endpoint: Valid API/WSS endpoint pair.
    func connect(to endpoint: RelayEndpoint) async throws

    /// Closes the relay connection.
    func disconnect() async

    /// Sends an envelope to the gateway.
    /// - Parameter envelope: Event payload to send.
    func send(_ envelope: RelayEnvelope) async throws

    /// Starts receiving gateway envelopes.
    func receive() -> AsyncThrowingStream<RelayEnvelope, Error>
}
