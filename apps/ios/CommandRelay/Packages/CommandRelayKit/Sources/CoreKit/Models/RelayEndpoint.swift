import Foundation

/// Canonical relay endpoint configuration used by transport and auth flows.
public struct RelayEndpoint: Sendable, Equatable {
    /// HTTPS API base URL used for token and pairing APIs.
    public let apiBaseURL: URL

    /// WSS URL used for terminal and session streaming.
    public let webSocketURL: URL

    /// Creates a validated endpoint pair.
    /// - Parameters:
    ///   - apiBaseURL: HTTPS endpoint for REST APIs.
    ///   - webSocketURL: WSS endpoint for live relay events.
    /// - Throws: `RelayEndpointError` when schemes are invalid.
    public init(apiBaseURL: URL, webSocketURL: URL) throws {
        guard apiBaseURL.scheme == "https" else {
            throw RelayEndpointError.invalidAPIBaseScheme(actual: apiBaseURL.scheme)
        }

        guard webSocketURL.scheme == "wss" else {
            throw RelayEndpointError.invalidWebSocketScheme(actual: webSocketURL.scheme)
        }

        self.apiBaseURL = apiBaseURL
        self.webSocketURL = webSocketURL
    }
}

/// Construction failures for `RelayEndpoint`.
public enum RelayEndpointError: Error, Sendable {
    /// The API base URL must use HTTPS.
    case invalidAPIBaseScheme(actual: String?)

    /// The WebSocket URL must use WSS.
    case invalidWebSocketScheme(actual: String?)
}
