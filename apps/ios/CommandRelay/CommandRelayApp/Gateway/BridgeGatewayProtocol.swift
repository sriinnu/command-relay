import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errors thrown while exchanging protocol envelopes with the bridge gateway.
enum BridgeGatewayError: Error, LocalizedError {
    case invalidEnvelope
    case unsupportedMessageFrame
    case missingField(name: String)
    case authRejected(code: String)
    case requestRejected(code: String)
    case requestTimedOut(type: String, requestId: String)
    case streamNotAttached

    var errorDescription: String? {
        switch self {
        case .invalidEnvelope:
            return "Received malformed gateway envelope."
        case .unsupportedMessageFrame:
            return "Received unsupported WebSocket frame."
        case let .missingField(name):
            return "Missing required field: \(name)."
        case let .authRejected(code):
            return "Gateway auth failed (\(code))."
        case let .requestRejected(code):
            return "Gateway request failed (\(code))."
        case let .requestTimedOut(type, requestId):
            return "Gateway request timed out (\(type), \(requestId))."
        case .streamNotAttached:
            return "Stream is not attached."
        }
    }
}

/// Decoded bridge envelope with untyped payload map.
struct BridgeGatewayEnvelope {
    let type: String
    let requestId: String?
    let timestampMs: Int64
    let payload: [String: Any]
}

/// Protocol encode/decode helpers for the bridge WebSocket envelope.
enum BridgeGatewayProtocol {
    static let protocolVersion = 1

    /// Converts a websocket frame into a gateway envelope.
    /// - Parameter message: Incoming frame from `URLSessionWebSocketTask`.
    /// - Returns: Parsed envelope.
    static func decode(_ message: URLSessionWebSocketTask.Message) throws -> BridgeGatewayEnvelope {
        let payloadData: Data
        switch message {
        case let .string(text):
            payloadData = Data(text.utf8)
        case let .data(data):
            payloadData = data
        @unknown default:
            throw BridgeGatewayError.unsupportedMessageFrame
        }

        guard let root = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any] else {
            throw BridgeGatewayError.invalidEnvelope
        }

        guard let type = root["type"] as? String else {
            throw BridgeGatewayError.missingField(name: "type")
        }

        let requestId = root["requestId"] as? String
        let timestampValue = root["timestamp"] as? NSNumber
        let timestampMs = timestampValue?.int64Value ?? 0
        let payload = root["payload"] as? [String: Any] ?? [:]

        return BridgeGatewayEnvelope(type: type, requestId: requestId, timestampMs: timestampMs, payload: payload)
    }

    /// Encodes a client request envelope as websocket text frame.
    /// - Parameters:
    ///   - type: Protocol message type.
    ///   - requestId: Correlation identifier.
    ///   - payload: JSON object payload.
    /// - Returns: WebSocket message ready to send.
    static func encodeClientRequest(
        type: String,
        requestId: String,
        payload: [String: Any]
    ) throws -> URLSessionWebSocketTask.Message {
        let object: [String: Any] = [
            "v": protocolVersion,
            "type": type,
            "requestId": requestId,
            "timestamp": Int64(Date().timeIntervalSince1970 * 1000),
            "payload": payload
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [])
        guard let text = String(data: data, encoding: .utf8) else {
            throw BridgeGatewayError.invalidEnvelope
        }
        return .string(text)
    }

    /// Reads a string payload field from an envelope.
    /// - Parameters:
    ///   - field: Payload key.
    ///   - envelope: Source envelope.
    /// - Returns: Non-empty string field when present.
    static func payloadString(_ field: String, in envelope: BridgeGatewayEnvelope) -> String? {
        guard let value = envelope.payload[field] as? String else { return nil }
        return value.isEmpty ? nil : value
    }

    /// Reads an integer payload field from an envelope.
    /// - Parameters:
    ///   - field: Payload key.
    ///   - envelope: Source envelope.
    /// - Returns: Parsed integer when present.
    static func payloadInt64(_ field: String, in envelope: BridgeGatewayEnvelope) -> Int64? {
        if let value = envelope.payload[field] as? NSNumber {
            return value.int64Value
        }
        if let value = envelope.payload[field] as? Int64 {
            return value
        }
        if let value = envelope.payload[field] as? Int {
            return Int64(value)
        }
        return nil
    }

    /// Reads a boolean payload field from an envelope.
    /// - Parameters:
    ///   - field: Payload key.
    ///   - envelope: Source envelope.
    /// - Returns: Parsed boolean when present.
    static func payloadBool(_ field: String, in envelope: BridgeGatewayEnvelope) -> Bool? {
        if let value = envelope.payload[field] as? Bool {
            return value
        }
        if let value = envelope.payload[field] as? NSNumber {
            return value.boolValue
        }
        return nil
    }

    /// Reads an object payload field from an envelope.
    /// - Parameters:
    ///   - field: Payload key.
    ///   - envelope: Source envelope.
    /// - Returns: JSON object field when present.
    static func payloadObject(_ field: String, in envelope: BridgeGatewayEnvelope) -> [String: Any]? {
        envelope.payload[field] as? [String: Any]
    }

    /// Resolves the best available error code from common gateway payload layouts.
    /// - Parameters:
    ///   - envelope: Source envelope.
    ///   - fallback: Code used when no explicit code is present.
    /// - Returns: Normalized lowercase code for compatibility checks.
    static func normalizedErrorCode(in envelope: BridgeGatewayEnvelope, fallback: String) -> String {
        if let directCode = firstErrorCode(in: envelope.payload) {
            return normalizeErrorCode(directCode)
        }

        if let details = payloadObject("details", in: envelope),
           let nestedCode = firstErrorCode(in: details) {
            return normalizeErrorCode(nestedCode)
        }

        if let nestedError = payloadObject("error", in: envelope),
           let nestedCode = firstErrorCode(in: nestedError) {
            return normalizeErrorCode(nestedCode)
        }

        return normalizeErrorCode(fallback)
    }

    /// Returns whether an error code indicates an input ownership/arbitration conflict.
    /// - Parameter code: Error code to evaluate.
    /// - Returns: `true` when the code should be treated as an ownership conflict.
    static func isOwnershipConflictCode(_ code: String) -> Bool {
        let normalized = normalizeErrorCode(code)
        let knownCodes: Set<String> = [
            "input_lane_conflict",
            "lane_conflict",
            "ownership_conflict",
            "input_ownership_conflict",
            "arbitration_conflict",
            "input_arbitration_conflict"
        ]

        if knownCodes.contains(normalized) {
            return true
        }

        return (normalized.contains("ownership") && normalized.contains("conflict")) ||
            (normalized.contains("arbitration") && normalized.contains("conflict"))
    }

    private static func firstErrorCode(in payload: [String: Any]) -> String? {
        let supportedKeys = ["code", "errorCode", "reasonCode"]
        for key in supportedKeys {
            if let code = payload[key] as? String,
               !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return code
            }
        }
        return nil
    }

    private static func normalizeErrorCode(_ code: String) -> String {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.replacingOccurrences(of: "-", with: "_")
    }
}
