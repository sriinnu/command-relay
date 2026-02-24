import XCTest
@testable import M0ProtocolMockClient

final class M0ReplayTests: XCTestCase {
    func testReplayPlannerReturnsOnlyEventsAfterLastSeq() {
        let planner = M0ReplayPlanner()
        let backlog = makeBacklog(range: UInt64(1)...UInt64(5))

        let replay = planner.replayEvents(from: backlog, lastSeq: 3)

        XCTAssertEqual(replay.map(\.streamSeq), [4, 5])
    }

    func testReconnectBuildsResumeRequestAndReplaysUnackedEvents() async {
        let cursorStore = M0ReplayCursorStore()
        let client = M0MockClient(streamID: "stream-1", cursorStore: cursorStore)

        _ = await client.append(event: .status(M0StatusEvent(code: "READY", message: "ready")), sentAtMs: 1)
        _ = await client.append(event: .outputChunk(M0OutputChunkEvent(chunk: "A", isFinal: false)), sentAtMs: 2)
        _ = await client.append(event: .outputChunk(M0OutputChunkEvent(chunk: "B", isFinal: true)), sentAtMs: 3)

        await client.acknowledge(seq: 2)
        _ = await client.append(event: .heartbeat(M0HeartbeatEvent(serverTimeMs: 4)), sentAtMs: 4)

        let reconnect = await client.reconnect()

        XCTAssertEqual(reconnect.resumeRequest.streamID, "stream-1")
        XCTAssertEqual(reconnect.resumeRequest.lastSeq, 2)
        XCTAssertEqual(reconnect.resumeRequest.streamSeq, 5)
        XCTAssertEqual(reconnect.replayEvents.map(\.streamSeq), [3, 4])
    }

    private func makeBacklog(range: ClosedRange<UInt64>) -> [M0Envelope<M0Event>] {
        range.map { seq in
            M0Envelope(
                streamID: "stream-1",
                streamSeq: seq,
                lastSeq: nil,
                sentAtMs: seq,
                event: .status(M0StatusEvent(code: "SEQ", message: "\(seq)"))
            )
        }
    }
}
