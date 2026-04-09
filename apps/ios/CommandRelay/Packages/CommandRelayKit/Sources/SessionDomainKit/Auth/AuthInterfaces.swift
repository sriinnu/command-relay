import CoreKit
import Foundation

/// Parsed data from a pairing QR code.
public struct PairingQRCode: Sendable, Equatable {
    /// Relay endpoint details advertised by the gateway.
    public let endpoint: RelayEndpoint

    /// One-time pairing code.
    public let pairingCode: String

    /// Absolute expiry for this QR payload.
    public let expiresAt: Date

    /// Creates a pairing payload model.
    /// - Parameters:
    ///   - endpoint: Relay endpoint parsed from QR.
    ///   - pairingCode: One-time pairing code.
    ///   - expiresAt: Expiry time in UTC.
    public init(endpoint: RelayEndpoint, pairingCode: String, expiresAt: Date) {
        self.endpoint = endpoint
        self.pairingCode = pairingCode
        self.expiresAt = expiresAt
    }
}

/// Device identity issued by the gateway after successful pairing.
public struct DeviceIdentity: Sendable, Equatable {
    /// Server-side stable device identifier.
    public let deviceID: String

    /// Human-friendly label shown in app settings.
    public let displayName: String

    /// Creates a device identity.
    /// - Parameters:
    ///   - deviceID: Stable device identifier.
    ///   - displayName: Human-friendly name.
    public init(deviceID: String, displayName: String) {
        self.deviceID = deviceID
        self.displayName = displayName
    }
}

/// Access policy returned by auth endpoints.
public struct SessionCapabilities: Sendable, Equatable {
    /// Input is disabled by default for safety.
    public let readOnly: Bool

    /// User can explicitly enable input after confirmation.
    public let canEnableInput: Bool

    /// Creates capability flags.
    /// - Parameters:
    ///   - readOnly: Whether session starts in read-only mode.
    ///   - canEnableInput: Whether user can opt into input.
    public init(readOnly: Bool, canEnableInput: Bool) {
        self.readOnly = readOnly
        self.canEnableInput = canEnableInput
    }
}

/// Interface for pairing and token lifecycle.
public protocol AuthSessionServicing: Sendable {
    /// Claims a one-time pairing code and returns device identity.
    /// - Parameter qrCode: Parsed QR payload.
    func pairDevice(using qrCode: PairingQRCode) async throws -> DeviceIdentity

    /// Rotates and returns an access token suitable for WebSocket auth.
    func refreshAccessToken() async throws -> String

    /// Returns the active capability set for current account and pane scope.
    func fetchCapabilities() async throws -> SessionCapabilities
}
