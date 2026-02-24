import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import M0ProtocolMockClient

final class M0WebSocketFramerTests: XCTestCase {
    func testDataFromStringFrameUsesUTF8Bytes() throws {
        let framer = M0WebSocketFramer()
        let message = URLSessionWebSocketTask.Message.string("{\"status\":\"ok\"}")

        let data = try framer.data(from: message)

        XCTAssertEqual(String(data: data, encoding: .utf8), "{\"status\":\"ok\"}")
    }

    func testMessagePrefersTextFramesForUTF8Payloads() {
        let framer = M0WebSocketFramer()
        let payload = Data("hello".utf8)

        let message = framer.message(from: payload, preferTextFrames: true)

        guard case let .string(text) = message else {
            XCTFail("Expected a text websocket frame.")
            return
        }
        XCTAssertEqual(text, "hello")
    }

    func testMessageFallsBackToBinaryForNonUTF8Payloads() {
        let framer = M0WebSocketFramer()
        let payload = Data([0xFF, 0xFE, 0xFD])

        let message = framer.message(from: payload, preferTextFrames: true)

        guard case let .data(data) = message else {
            XCTFail("Expected a binary websocket frame.")
            return
        }
        XCTAssertEqual(data, payload)
    }
}
