import XCTest
@testable import M0ProtocolMockClient

final class M0ReconnectBackoffPolicyTests: XCTestCase {
    func testAttemptZeroUsesInitialDelayWithoutJitter() {
        let policy = M0ReconnectBackoffPolicy(
            initialDelayMs: 200,
            multiplier: 2,
            maxDelayMs: 5_000,
            jitterRatio: 0
        )

        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 0, randomUnit: 0.25), 200)
    }

    func testDelayGrowsExponentiallyAndCapsAtMax() {
        let policy = M0ReconnectBackoffPolicy(
            initialDelayMs: 100,
            multiplier: 2,
            maxDelayMs: 500,
            jitterRatio: 0
        )

        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 0), 100)
        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 1), 200)
        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 2), 400)
        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 3), 500)
        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 10), 500)
    }

    func testJitterSamplingUsesRandomUnitBounds() {
        let policy = M0ReconnectBackoffPolicy(
            initialDelayMs: 100,
            multiplier: 1,
            maxDelayMs: 200,
            jitterRatio: 0.2
        )

        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 0, randomUnit: 0), 80)
        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 0, randomUnit: 1), 120)
    }

    func testRandomInputIsClampedToUnitInterval() {
        let policy = M0ReconnectBackoffPolicy(
            initialDelayMs: 100,
            multiplier: 1,
            maxDelayMs: 200,
            jitterRatio: 0.2
        )

        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 0, randomUnit: -10), 80)
        XCTAssertEqual(policy.delayMilliseconds(forAttempt: 0, randomUnit: 10), 120)
    }
}
