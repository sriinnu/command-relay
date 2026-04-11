import Foundation

/// Errors thrown while processing decoded transport frames into typed events.
public enum M0DecodedEventPipelineError: Error, Equatable, LocalizedError, Sendable {
    /// Raised when JSON-to-envelope decoding fails.
    case envelopeDecodingFailed(String)

    /// Raised when envelope-to-event mapping fails.
    case eventMappingFailed(String)

    /// Human-readable error description.
    public var errorDescription: String? {
        switch self {
        case let .envelopeDecodingFailed(message):
            return "Envelope decoding failed: \(message)"
        case let .eventMappingFailed(message):
            return "Event mapping failed: \(message)"
        }
    }
}

/// Typed output from a frame decode-and-map pass.
public struct M0DecodedEvent<Payload: Codable & Equatable & Sendable, Event: Sendable>: Sendable {
    /// Decoded typed envelope from the websocket frame.
    public let envelope: M0Envelope<Payload>

    /// Event value emitted by the mapping hook.
    public let event: Event

    /// Creates a decoded event payload.
    /// - Parameters:
    ///   - envelope: Typed decoded envelope.
    ///   - event: Mapped event output.
    public init(envelope: M0Envelope<Payload>, event: Event) {
        self.envelope = envelope
        self.event = event
    }
}

/// Hook-based pipeline for `Data -> M0Envelope<Payload> -> Event`.
public struct M0DecodedEventPipeline<Payload: Codable & Equatable & Sendable, Event: Sendable>: Sendable {
    /// Hook signature for frame-to-envelope decoding.
    public typealias DecodeEnvelopeHook = @Sendable (Data) throws -> M0Envelope<Payload>

    /// Hook signature for envelope-to-event mapping.
    public typealias MapEventHook = @Sendable (M0Envelope<Payload>) throws -> Event

    private let decodeEnvelope: DecodeEnvelopeHook
    private let mapEvent: MapEventHook

    /// Creates a typed event pipeline.
    /// - Parameters:
    ///   - decodeEnvelope: Decodes frame bytes into a typed envelope.
    ///   - mapEvent: Maps a decoded envelope to the consumer event.
    public init(
        decodeEnvelope: @escaping DecodeEnvelopeHook,
        mapEvent: @escaping MapEventHook
    ) {
        self.decodeEnvelope = decodeEnvelope
        self.mapEvent = mapEvent
    }

    /// Runs the decode-and-map pipeline for one websocket frame.
    /// - Parameter frameData: Raw frame bytes.
    /// - Returns: Typed envelope and mapped event.
    public func process(frameData: Data) throws -> M0DecodedEvent<Payload, Event> {
        let envelope: M0Envelope<Payload>
        do {
            envelope = try decodeEnvelope(frameData)
        } catch {
            throw M0DecodedEventPipelineError.envelopeDecodingFailed(String(describing: error))
        }

        let event: Event
        do {
            event = try mapEvent(envelope)
        } catch {
            throw M0DecodedEventPipelineError.eventMappingFailed(String(describing: error))
        }

        return M0DecodedEvent(envelope: envelope, event: event)
    }
}

public extension M0DecodedEventPipeline where Event == M0Envelope<Payload> {
    /// Creates a JSON pipeline that emits decoded envelopes as-is.
    /// - Returns: Pipeline that decodes `M0Envelope<Payload>` from JSON bytes.
    static func jsonEnvelopePassthrough() -> Self {
        Self(
            decodeEnvelope: { frameData in
                try JSONDecoder().decode(M0Envelope<Payload>.self, from: frameData)
            },
            mapEvent: { envelope in envelope }
        )
    }
}
