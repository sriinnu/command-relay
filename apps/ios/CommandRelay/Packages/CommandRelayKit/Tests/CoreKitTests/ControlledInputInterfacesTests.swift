import SessionDomainKit
import XCTest

final class ControlledInputInterfacesTests: XCTestCase {
    func testPolicyDefaultsToReadOnly() {
        let policy = InputControlPolicy(canEnableInput: true)

        XCTAssertEqual(policy.defaultMode, .readOnly)
        XCTAssertTrue(policy.requiresExplicitEnable)
        XCTAssertFalse(policy.canSendInput(currentMode: .readOnly))
        XCTAssertTrue(policy.canSendInput(currentMode: .enabled))
    }

    func testPolicyClampsPayloadByteLimitToPositiveValue() {
        let policy = InputControlPolicy(
            defaultMode: .readOnly,
            canEnableInput: true,
            requiresExplicitEnable: true,
            maxPayloadBytes: 0
        )

        XCTAssertEqual(policy.maxPayloadBytes, 1)
    }

    func testPolicyCapabilityOverrideKeepsInputBlockedWhenEnableIsNotAllowed() {
        let policy = InputControlPolicy(canEnableInput: false)

        XCTAssertFalse(policy.canSendInput(currentMode: .enabled))
        XCTAssertFalse(policy.canSendInput(currentMode: .readOnly))
    }

    func testAuditRecordCodableRoundTrip() throws {
        let actor = InputAuditActor(actorID: "device-1", displayName: "Primary iPhone")
        let record = InputAuditRecord(
            id: "evt-100",
            sessionID: "session-42",
            action: .sendInput,
            actor: actor,
            occurredAt: Date(timeIntervalSince1970: 1_700_000_000),
            reason: "Command dispatch"
        )

        let data = try JSONEncoder().encode(record)
        let decoded = try JSONDecoder().decode(InputAuditRecord.self, from: data)

        XCTAssertEqual(decoded, record)
    }

    func testInputControlStateEquatableAndCodableRoundTrip() throws {
        let actor = InputAuditActor(actorID: "device-2", displayName: "Work iPad")
        let audit = InputAuditRecord(
            id: "evt-200",
            sessionID: "session-11",
            action: .enableInput,
            actor: actor,
            occurredAt: Date(timeIntervalSince1970: 1_700_100_000),
            reason: nil
        )
        let state = InputControlState(
            sessionID: "session-11",
            mode: .enabled,
            updatedAt: Date(timeIntervalSince1970: 1_700_100_001),
            auditRecord: audit
        )

        let data = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(InputControlState.self, from: data)

        XCTAssertEqual(decoded, state)
    }

    func testSendInputRequestTracksUTF8ByteCount() {
        let request = SendInputRequest(
            sessionID: "session-25",
            actor: InputAuditActor(actorID: "device-3", displayName: "QA Mac"),
            payload: SessionInputPayload(text: "ls -la\n")
        )

        XCTAssertEqual(request.payload.utf8ByteCount, 7)
    }
}
