import Foundation

/// Reconnect lifecycle phases for M1 read-only stream recovery.
public enum M1ReconnectPhase: Equatable, Sendable {
    /// No active or pending reconnect behavior.
    case idle

    /// Active transport session with no reconnect pending.
    case connected

    /// Waiting before issuing the next reconnect attempt.
    case waiting(attempt: Int, delayMs: UInt64)

    /// Reconnect request should be sent now.
    case reconnecting(attempt: Int)

    /// State machine is terminal and ignores new reconnect triggers.
    case stopped
}

/// Full reconnect state used by the state machine transition function.
public struct M1ReconnectState: Equatable, Sendable {
    /// Stream identifier used in reconnect resume requests.
    public let streamID: String

    /// Sequence value to send in the next reconnect request.
    public let nextStreamSeq: UInt64

    /// Last fully applied output sequence.
    public let lastSeq: UInt64

    /// Current reconnect phase.
    public let phase: M1ReconnectPhase

    /// Creates reconnect state.
    /// - Parameters:
    ///   - streamID: Stream identifier for reconnect.
    ///   - nextStreamSeq: Next request sequence value.
    ///   - lastSeq: Last applied output sequence.
    ///   - phase: Current reconnect phase.
    public init(
        streamID: String,
        nextStreamSeq: UInt64 = 1,
        lastSeq: UInt64 = 0,
        phase: M1ReconnectPhase = .idle
    ) {
        self.streamID = streamID
        self.nextStreamSeq = max(nextStreamSeq, 1)
        self.lastSeq = lastSeq
        self.phase = phase
    }

    /// Returns a copy with updated reconnect cursor metadata.
    /// - Parameters:
    ///   - nextStreamSeq: Updated request sequence value.
    ///   - lastSeq: Updated last applied stream sequence.
    /// - Returns: Updated reconnect state.
    public func updatingCursor(nextStreamSeq: UInt64, lastSeq: UInt64) -> Self {
        Self(
            streamID: streamID,
            nextStreamSeq: nextStreamSeq,
            lastSeq: lastSeq,
            phase: phase
        )
    }
}

/// Input triggers consumed by the reconnect state machine.
public enum M1ReconnectTrigger: Equatable, Sendable {
    /// Transport connected or reconnected successfully.
    case connected

    /// Transport disconnected and should enter reconnect flow.
    case disconnected

    /// Delay timer fired and reconnect request should be prepared.
    case reconnectTimerFired

    /// A reconnect request failed and should be retried.
    case reconnectFailed

    /// Cursor metadata changed from stream processing.
    case cursorUpdated(nextStreamSeq: UInt64, lastSeq: UInt64)

    /// Stops the machine and suppresses future reconnect scheduling.
    case stop
}

/// Side-effect hook points emitted by reconnect transitions.
public enum M1ReconnectHookEvent: Equatable, Sendable {
    /// Schedule a reconnect timer for a specific attempt.
    case reconnectScheduled(attempt: Int, delayMs: UInt64)

    /// Prepare and emit a typed resume request for reconnect send.
    case resumeRequestPrepared(M0ResumeRequest)
}

/// Pure reconnect transition engine with hook events for effect handlers.
public struct M1ReconnectStateMachine: Sendable {
    /// Random source used for backoff jitter sampling.
    public typealias RandomUnitProvider = @Sendable () -> Double

    private let backoffPolicy: M0ReconnectBackoffPolicy
    private let replayPlanner: M0ReplayPlanner
    private let randomUnitProvider: RandomUnitProvider

    /// Creates a reconnect state machine.
    /// - Parameters:
    ///   - backoffPolicy: Retry delay policy.
    ///   - replayPlanner: Resume request planner.
    ///   - randomUnitProvider: Random source for jitter.
    public init(
        backoffPolicy: M0ReconnectBackoffPolicy = M0ReconnectBackoffPolicy(),
        replayPlanner: M0ReplayPlanner = M0ReplayPlanner(),
        randomUnitProvider: @escaping RandomUnitProvider = { 0.5 }
    ) {
        self.backoffPolicy = backoffPolicy
        self.replayPlanner = replayPlanner
        self.randomUnitProvider = randomUnitProvider
    }

    /// Applies one trigger and returns the next state plus hook events.
    /// - Parameters:
    ///   - state: Current reconnect state.
    ///   - trigger: Incoming reconnect trigger.
    /// - Returns: Next reconnect state and emitted hook events.
    public func transition(
        from state: M1ReconnectState,
        trigger: M1ReconnectTrigger
    ) -> (state: M1ReconnectState, hooks: [M1ReconnectHookEvent]) {
        switch trigger {
        case let .cursorUpdated(nextStreamSeq, lastSeq):
            return (
                state: state.updatingCursor(nextStreamSeq: nextStreamSeq, lastSeq: lastSeq),
                hooks: []
            )

        case .connected:
            return (state: withPhase(.connected, from: state), hooks: [])

        case .disconnected:
            guard state.phase != .stopped else {
                return (state: state, hooks: [])
            }

            switch state.phase {
            case .waiting, .reconnecting:
                return (state: state, hooks: [])
            case .idle, .connected, .stopped:
                let attempt = 1
                let delayMs = delay(forAttempt: attempt)
                let nextState = withPhase(.waiting(attempt: attempt, delayMs: delayMs), from: state)
                return (
                    state: nextState,
                    hooks: [.reconnectScheduled(attempt: attempt, delayMs: delayMs)]
                )
            }

        case .reconnectTimerFired:
            guard case let .waiting(attempt, _) = state.phase else {
                return (state: state, hooks: [])
            }

            let request = replayPlanner.makeResumeRequest(
                streamID: state.streamID,
                streamSeq: state.nextStreamSeq,
                lastSeq: state.lastSeq
            )
            let nextState = withPhase(.reconnecting(attempt: attempt), from: state)
            return (state: nextState, hooks: [.resumeRequestPrepared(request)])

        case .reconnectFailed:
            guard case let .reconnecting(currentAttempt) = state.phase else {
                return (state: state, hooks: [])
            }

            let nextAttempt = currentAttempt + 1
            let delayMs = delay(forAttempt: nextAttempt)
            let nextState = withPhase(.waiting(attempt: nextAttempt, delayMs: delayMs), from: state)
            return (
                state: nextState,
                hooks: [.reconnectScheduled(attempt: nextAttempt, delayMs: delayMs)]
            )

        case .stop:
            return (state: withPhase(.stopped, from: state), hooks: [])
        }
    }

    private func delay(forAttempt attempt: Int) -> UInt64 {
        let zeroBasedAttempt = max(attempt - 1, 0)
        return backoffPolicy.delayMilliseconds(
            forAttempt: zeroBasedAttempt,
            randomUnit: randomUnitProvider()
        )
    }

    private func withPhase(_ phase: M1ReconnectPhase, from state: M1ReconnectState) -> M1ReconnectState {
        M1ReconnectState(
            streamID: state.streamID,
            nextStreamSeq: state.nextStreamSeq,
            lastSeq: state.lastSeq,
            phase: phase
        )
    }
}
