import XCTest
@testable import M0ProtocolMockClient

final class M2ControlledInputPolicyStateMachineTests: XCTestCase {
    private static let ownershipConflictErrorCode = "ownership_conflict"

    func testDefaultStateIsReadOnlyAndIdle() {
        let state = M2ControlledInputPolicyState()

        XCTAssertEqual(state.mode, .readOnly)
        XCTAssertEqual(state.phase, .idle)
        XCTAssertTrue(state.isReadOnly)
        XCTAssertFalse(state.isKillSwitchEnabled)
        XCTAssertNil(state.lastErrorCode)
    }

    func testExplicitEnableMovesToPendingThenEnabledOnAck() {
        let machine = M2ControlledInputPolicyStateMachine()
        let initial = M2ControlledInputPolicyState()

        let pending = machine.transition(from: initial, trigger: .requestEnable)
        let enabled = machine.transition(from: pending, trigger: .ackEnable)

        XCTAssertEqual(pending.mode, .readOnly)
        XCTAssertEqual(pending.phase, .pendingEnable)
        XCTAssertNil(pending.lastErrorCode)

        XCTAssertEqual(enabled.mode, .enabled)
        XCTAssertEqual(enabled.phase, .idle)
        XCTAssertFalse(enabled.isReadOnly)
        XCTAssertNil(enabled.lastErrorCode)
    }

    func testKillSwitchBlocksEnableAndKeepsModeReadOnly() {
        let machine = M2ControlledInputPolicyStateMachine()
        let initial = M2ControlledInputPolicyState()
        let blocked = machine.transition(from: initial, trigger: .setKillSwitch(enabled: true))
        let attemptedEnable = machine.transition(from: blocked, trigger: .requestEnable)
        let ignoredAck = machine.transition(from: attemptedEnable, trigger: .ackEnable)

        XCTAssertEqual(attemptedEnable.mode, .readOnly)
        XCTAssertEqual(attemptedEnable.phase, .blockedByKillSwitch)
        XCTAssertTrue(attemptedEnable.isKillSwitchEnabled)
        XCTAssertEqual(
            attemptedEnable.lastErrorCode,
            M2ControlledInputPolicyStateMachine.killSwitchBlockedErrorCode
        )
        XCTAssertEqual(ignoredAck, attemptedEnable)
    }

    func testOwnershipConflictFailureKeepsReadOnlyAndAllowsRetry() {
        let machine = M2ControlledInputPolicyStateMachine()
        let initial = M2ControlledInputPolicyState()
        let pending = machine.transition(from: initial, trigger: .requestEnable)
        let failed = machine.transition(
            from: pending,
            trigger: .requestFailed(errorCode: Self.ownershipConflictErrorCode)
        )
        let retryPending = machine.transition(from: failed, trigger: .requestEnable)

        XCTAssertEqual(failed.mode, .readOnly)
        XCTAssertEqual(failed.phase, .failed)
        XCTAssertEqual(failed.lastErrorCode, Self.ownershipConflictErrorCode)

        XCTAssertEqual(retryPending.phase, .pendingEnable)
        XCTAssertNil(retryPending.lastErrorCode)
    }

    func testSafetyOverrideIgnoresStaleEnableAckAfterKillSwitchCycle() {
        let machine = M2ControlledInputPolicyStateMachine()
        let initial = M2ControlledInputPolicyState()
        let pendingEnable = machine.transition(from: initial, trigger: .requestEnable)
        let blocked = machine.transition(from: pendingEnable, trigger: .setKillSwitch(enabled: true))
        let unblocked = machine.transition(from: blocked, trigger: .setKillSwitch(enabled: false))
        let staleEnableAck = machine.transition(from: unblocked, trigger: .ackEnable)

        XCTAssertEqual(blocked.mode, .readOnly)
        XCTAssertEqual(blocked.phase, .blockedByKillSwitch)
        XCTAssertEqual(blocked.lastErrorCode, M2ControlledInputPolicyStateMachine.killSwitchBlockedErrorCode)

        XCTAssertEqual(unblocked.mode, .readOnly)
        XCTAssertEqual(unblocked.phase, .idle)
        XCTAssertEqual(unblocked.lastErrorCode, M2ControlledInputPolicyStateMachine.killSwitchBlockedErrorCode)
        XCTAssertEqual(staleEnableAck, unblocked)
    }
}
