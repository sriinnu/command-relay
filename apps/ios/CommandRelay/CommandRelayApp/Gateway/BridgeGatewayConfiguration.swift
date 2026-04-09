import Foundation

/// Runtime configuration for the iOS read-only WebSocket spike.
struct BridgeGatewayConfiguration: Sendable {
    /// WebSocket endpoint (`ws://` for local tunnel, `wss://` for remote).
    let webSocketURL: URL

    /// Optional bearer token used in the `auth` envelope.
    let authToken: String?

    /// Receive timeout used for request/response handshakes.
    let requestTimeoutMs: UInt64

    /// Reads gateway configuration from process environment.
    /// - Parameter environment: Process environment map.
    /// - Returns: Parsed configuration when `COMMANDRELAY_WS_URL` is valid.
    static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> BridgeGatewayConfiguration? {
        guard let rawURL = environment["COMMANDRELAY_WS_URL"],
              let url = URL(string: rawURL),
              let scheme = url.scheme,
              ["ws", "wss"].contains(scheme.lowercased()) else {
            return nil
        }

        let rawTimeout = environment["COMMANDRELAY_WS_TIMEOUT_MS"]
        let timeoutMs = rawTimeout.flatMap(UInt64.init) ?? 8_000
        let token = environment["COMMANDRELAY_AUTH_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines)

        return BridgeGatewayConfiguration(
            webSocketURL: url,
            authToken: token?.isEmpty == true ? nil : token,
            requestTimeoutMs: timeoutMs
        )
    }
}
