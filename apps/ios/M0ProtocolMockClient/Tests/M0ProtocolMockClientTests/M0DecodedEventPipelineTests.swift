import XCTest
@testable import M0ProtocolMockClient

final class M0DecodedEventPipelineTests: XCTestCase {
    func testPipelineDecodesEnvelopeAndMapsTypedEvent() throws {
        let envelope: M0Envelope<M0Event> = M0Envelope(
            streamID: "stream-1",
            streamSeq: 7,
            lastSeq: 6,
            sentAtMs: 101,
            event: M0Event.status(M0StatusEvent(code: "READY", message: "ok"))
        )
        let frameData = try JSONEncoder().encode(envelope)

        let pipeline = M0DecodedEventPipeline<M0Event, String>(
            decodeEnvelope: { data in
                try JSONDecoder().decode(M0Envelope<M0Event>.self, from: data)
            },
            mapEvent: { decodedEnvelope in
                switch decodedEnvelope.event {
                case let M0Event.status(status):
                    return status.code
                default:
                    return "UNKNOWN"
                }
            }
        )

        let decoded = try pipeline.process(frameData: frameData)

        XCTAssertEqual(decoded.envelope, envelope)
        XCTAssertEqual(decoded.event, "READY")
    }

    func testJSONPassthroughPipelineReturnsEnvelopeAsEvent() throws {
        let envelope: M0Envelope<M0Event> = M0Envelope(
            streamID: "stream-1",
            streamSeq: 2,
            lastSeq: nil,
            sentAtMs: 55,
            event: M0Event.heartbeat(M0HeartbeatEvent(serverTimeMs: 55))
        )
        let frameData = try JSONEncoder().encode(envelope)
        let pipeline = M0DecodedEventPipeline<M0Event, M0Envelope<M0Event>>.jsonEnvelopePassthrough()

        let decoded = try pipeline.process(frameData: frameData)

        XCTAssertEqual(decoded.event, envelope)
    }

    func testPipelineWrapsDecodeFailures() {
        let pipeline = M0DecodedEventPipeline<M0Event, M0Envelope<M0Event>>.jsonEnvelopePassthrough()

        XCTAssertThrowsError(try pipeline.process(frameData: Data("not-json".utf8))) { error in
            guard case .envelopeDecodingFailed = error as? M0DecodedEventPipelineError else {
                XCTFail("Expected envelope decode failure, got \(error).")
                return
            }
        }
    }
}
