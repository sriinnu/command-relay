import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errors thrown while converting WebSocket messages to transport frame data.
public enum M0WebSocketFramingError: Error, Equatable, LocalizedError, Sendable {
    /// Raised when a text frame cannot be encoded as UTF-8 bytes.
    case invalidUTF8TextFrame

    /// Raised when an unknown websocket message type is encountered.
    case unsupportedMessageType

    /// Human-readable error description.
    public var errorDescription: String? {
        switch self {
        case .invalidUTF8TextFrame:
            return "WebSocket text frame was not valid UTF-8."
        case .unsupportedMessageType:
            return "Unsupported WebSocket message type."
        }
    }
}

/// Encodes and decodes `URLSessionWebSocketTask.Message` values for protocol processing.
public struct M0WebSocketFramer: Sendable {
    /// Creates a websocket framer.
    public init() {}

    /// Converts an inbound websocket message to raw frame data.
    /// - Parameter message: Inbound websocket frame.
    /// - Returns: Raw frame bytes to pass through protocol decoding.
    public func data(from message: URLSessionWebSocketTask.Message) throws -> Data {
        switch message {
        case let .data(frameData):
            return frameData
        case let .string(text):
            guard let frameData = text.data(using: .utf8) else {
                throw M0WebSocketFramingError.invalidUTF8TextFrame
            }
            return frameData
        @unknown default:
            throw M0WebSocketFramingError.unsupportedMessageType
        }
    }

    /// Converts raw bytes to an outbound websocket message.
    /// - Parameters:
    ///   - data: Protocol payload bytes.
    ///   - preferTextFrames: Sends text frames when bytes are valid UTF-8.
    /// - Returns: Outbound websocket frame.
    public func message(from data: Data, preferTextFrames: Bool = true) -> URLSessionWebSocketTask.Message {
        if preferTextFrames, let text = String(data: data, encoding: .utf8) {
            return .string(text)
        }
        return .data(data)
    }
}
