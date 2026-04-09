import XCTest
@testable import M0ProtocolMockClient

final class M1PaneStreamReducerTests: XCTestCase {
    func testReducerAppendsOutputAndAdvancesSequence() {
        let reducer = M1PaneStreamReducer()
        let paneID = "pane-1"
        var state = M1PaneStreamState(paneID: paneID)

        state = reducer.reduce(state: state, action: .attachRequested(paneID: paneID))
        state = reducer.reduce(state: state, action: .attachConfirmed)
        state = reducer.reduce(state: state, action: .receiveEnvelope(makeOutputEnvelope(streamID: paneID, seq: 1, chunk: "A")))
        state = reducer.reduce(state: state, action: .receiveEnvelope(makeOutputEnvelope(streamID: paneID, seq: 2, chunk: "B")))

        XCTAssertEqual(state.connectionState, .attached)
        XCTAssertEqual(state.output, "AB")
        XCTAssertEqual(state.lastAppliedSeq, 2)
        XCTAssertFalse(state.hasSequenceGap)
    }

    func testReducerIgnoresDuplicateSequenceAndDifferentPaneEvents() {
        let reducer = M1PaneStreamReducer()
        let paneID = "pane-1"
        var state = M1PaneStreamState(
            paneID: paneID,
            connectionState: .attached,
            output: "AB",
            lastAppliedSeq: 2
        )

        state = reducer.reduce(state: state, action: .receiveEnvelope(makeOutputEnvelope(streamID: paneID, seq: 2, chunk: "DUP")))
        state = reducer.reduce(state: state, action: .receiveEnvelope(makeOutputEnvelope(streamID: "other-pane", seq: 3, chunk: "OTHER")))

        XCTAssertEqual(state.output, "AB")
        XCTAssertEqual(state.lastAppliedSeq, 2)
    }

    func testReducerMarksGapForNonContiguousSequence() {
        let reducer = M1PaneStreamReducer()
        let paneID = "pane-1"
        var state = M1PaneStreamState(
            paneID: paneID,
            connectionState: .attached,
            output: "A",
            lastAppliedSeq: 1
        )

        state = reducer.reduce(state: state, action: .receiveEnvelope(makeOutputEnvelope(streamID: paneID, seq: 3, chunk: "C")))

        XCTAssertEqual(state.output, "AC")
        XCTAssertEqual(state.lastAppliedSeq, 3)
        XCTAssertTrue(state.hasSequenceGap)
    }

    func testReducerEnforcesReadOnlyFlagAfterReconnectActions() {
        let reducer = M1PaneStreamReducer()
        var state = M1PaneStreamState(paneID: "pane-1", isReadOnly: false)

        state = reducer.reduce(state: state, action: .reconnecting(attempt: 2))
        XCTAssertEqual(state.connectionState, .reconnecting)
        XCTAssertTrue(state.isReadOnly)

        state = reducer.reduce(state: state, action: .reconnectSucceeded)
        XCTAssertEqual(state.connectionState, .attached)
        XCTAssertTrue(state.isReadOnly)
    }

    private func makeOutputEnvelope(streamID: String, seq: UInt64, chunk: String) -> M0Envelope<M0Event> {
        M0Envelope(
            streamID: streamID,
            streamSeq: seq,
            lastSeq: seq > 0 ? seq - 1 : nil,
            sentAtMs: seq,
            event: .outputChunk(M0OutputChunkEvent(chunk: chunk, isFinal: false))
        )
    }
}
