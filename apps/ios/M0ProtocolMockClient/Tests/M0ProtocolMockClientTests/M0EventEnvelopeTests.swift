import XCTest
@testable import M0ProtocolMockClient

final class M0EventEnvelopeTests: XCTestCase {
    func testEnvelopeRoundTripEncodingPreservesTypedPayload() throws {
        let envelope = M0Envelope(
            streamID: "stream-1",
            streamSeq: 42,
            lastSeq: 41,
            sentAtMs: 1_707_000_000_000,
            event: M0Event.outputChunk(
                M0OutputChunkEvent(chunk: "hello", isFinal: true)
            )
        )

        let encoded = try JSONEncoder().encode(envelope)
        let decoded = try JSONDecoder().decode(M0Envelope<M0Event>.self, from: encoded)

        XCTAssertEqual(decoded, envelope)
    }

    func testResumeRequestUsesSnakeCaseJSONKeys() throws {
        let request = M0ResumeRequest(streamID: "stream-1", streamSeq: 11, lastSeq: 10)
        let encoded = try JSONEncoder().encode(request)
        let json = try XCTUnwrap(String(data: encoded, encoding: .utf8))

        XCTAssertTrue(json.contains("\"stream_id\""))
        XCTAssertTrue(json.contains("\"stream_seq\""))
        XCTAssertTrue(json.contains("\"last_seq\""))
    }
}
