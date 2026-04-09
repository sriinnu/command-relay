import XCTest
@testable import M0ProtocolMockClient

final class M1ReconnectStateMachineTests: XCTestCase {
    func testDisconnectSchedulesFirstReconnectAttempt() {
        let machine = makeMachine()
        let state = M1ReconnectState(streamID: "pane-1", nextStreamSeq: 5, lastSeq: 3, phase: .connected)

        let result = machine.transition(from: state, trigger: .disconnected)

        XCTAssertEqual(result.state.phase, .waiting(attempt: 1, delayMs: 100))
        XCTAssertEqual(result.hooks, [.reconnectScheduled(attempt: 1, delayMs: 100)])
    }

    func testReconnectTimerFiredEmitsResumeRequestHook() {
        let machine = makeMachine()
        let state = M1ReconnectState(
            streamID: "pane-1",
            nextStreamSeq: 8,
            lastSeq: 7,
            phase: .waiting(attempt: 1, delayMs: 100)
        )

        let result = machine.transition(from: state, trigger: .reconnectTimerFired)

        XCTAssertEqual(result.state.phase, .reconnecting(attempt: 1))
        XCTAssertEqual(
            result.hooks,
            [.resumeRequestPrepared(M0ResumeRequest(streamID: "pane-1", streamSeq: 8, lastSeq: 7))]
        )
    }

    func testReconnectFailureSchedulesNextAttemptWithBackoff() {
        let machine = makeMachine()
        let state = M1ReconnectState(streamID: "pane-1", nextStreamSeq: 10, lastSeq: 4, phase: .reconnecting(attempt: 1))

        let result = machine.transition(from: state, trigger: .reconnectFailed)

        XCTAssertEqual(result.state.phase, .waiting(attempt: 2, delayMs: 200))
        XCTAssertEqual(result.hooks, [.reconnectScheduled(attempt: 2, delayMs: 200)])
    }

    func testStopPreventsFurtherReconnectScheduling() {
        let machine = makeMachine()
        let connected = M1ReconnectState(streamID: "pane-1", phase: .connected)

        let stopped = machine.transition(from: connected, trigger: .stop)
        let disconnectedAfterStop = machine.transition(from: stopped.state, trigger: .disconnected)

        XCTAssertEqual(stopped.state.phase, .stopped)
        XCTAssertTrue(stopped.hooks.isEmpty)
        XCTAssertEqual(disconnectedAfterStop.state.phase, .stopped)
        XCTAssertTrue(disconnectedAfterStop.hooks.isEmpty)
    }

    private func makeMachine() -> M1ReconnectStateMachine {
        let backoffPolicy = M0ReconnectBackoffPolicy(
            initialDelayMs: 100,
            multiplier: 2,
            maxDelayMs: 500,
            jitterRatio: 0
        )

        return M1ReconnectStateMachine(
            backoffPolicy: backoffPolicy,
            replayPlanner: M0ReplayPlanner(),
            randomUnitProvider: { 0 }
        )
    }
}
