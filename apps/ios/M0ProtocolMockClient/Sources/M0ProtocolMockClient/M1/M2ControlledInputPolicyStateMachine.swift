import Foundation

/// Policy mode exposed to iOS UI for controlled-input capability.
public enum M2ControlledInputPolicyMode: String, Codable, Equatable, Sendable {
    /// Input is disabled and the pane/session is read-only.
    case readOnly

    /// Input is enabled and UI may present controlled input affordances.
    case enabled
}

/// Transition phase for policy mutation requests.
public enum M2ControlledInputTransitionPhase: String, Codable, Equatable, Sendable {
    /// No request is currently in-flight.
    case idle

    /// Waiting for server acknowledgement of an enable request.
    case pendingEnable

    /// Waiting for server acknowledgement of a disable request.
    case pendingDisable

    /// Request was blocked by a local kill-switch guard.
    case blockedByKillSwitch

    /// Last request failed with a protocol/domain error.
    case failed
}

/// Mutable state for mock-level controlled-input policy transitions.
public struct M2ControlledInputPolicyState: Equatable, Sendable {
    /// Current effective policy mode.
    public var mode: M2ControlledInputPolicyMode

    /// Current transition phase for request/ack handling.
    public var phase: M2ControlledInputTransitionPhase

    /// Local hard-stop flag that blocks enable transitions.
    public var isKillSwitchEnabled: Bool

    /// Last known domain error code from request processing.
    public var lastErrorCode: String?

    /// Creates a default read-only policy state.
    /// - Parameters:
    ///   - mode: Initial effective policy mode.
    ///   - phase: Initial transition phase.
    ///   - isKillSwitchEnabled: Initial kill-switch state.
    ///   - lastErrorCode: Initial domain error code.
    public init(
        mode: M2ControlledInputPolicyMode = .readOnly,
        phase: M2ControlledInputTransitionPhase = .idle,
        isKillSwitchEnabled: Bool = false,
        lastErrorCode: String? = nil
    ) {
        self.mode = mode
        self.phase = phase
        self.isKillSwitchEnabled = isKillSwitchEnabled
        self.lastErrorCode = lastErrorCode
    }

    /// Whether UI should currently render as read-only.
    public var isReadOnly: Bool {
        mode == .readOnly
    }
}

/// Input triggers that drive policy transitions in the mock domain.
public enum M2ControlledInputPolicyTrigger: Equatable, Sendable {
    /// User requested enabling controlled input.
    case requestEnable

    /// User requested disabling controlled input.
    case requestDisable

    /// Server acknowledged an enable request.
    case ackEnable

    /// Server acknowledged a disable request.
    case ackDisable

    /// Server/domain rejected the current in-flight request.
    case requestFailed(errorCode: String)

    /// Local kill-switch setting changed.
    case setKillSwitch(enabled: Bool)
}

/// Pure transition engine for mock controlled-input policy behavior.
public struct M2ControlledInputPolicyStateMachine: Sendable {
    /// Standardized error code used when kill-switch blocks enable requests.
    public static let killSwitchBlockedErrorCode = "kill_switch_enabled"

    /// Creates a policy state machine.
    public init() {}

    /// Applies one trigger and returns the next policy state.
    /// - Parameters:
    ///   - state: Current policy state.
    ///   - trigger: Requested transition trigger.
    /// - Returns: Next policy state.
    public func transition(
        from state: M2ControlledInputPolicyState,
        trigger: M2ControlledInputPolicyTrigger
    ) -> M2ControlledInputPolicyState {
        var next = state

        switch trigger {
        case let .setKillSwitch(enabled):
            next.isKillSwitchEnabled = enabled
            if enabled {
                next.mode = .readOnly
                next.phase = .blockedByKillSwitch
                next.lastErrorCode = Self.killSwitchBlockedErrorCode
            } else if next.phase == .blockedByKillSwitch {
                next.phase = .idle
            }

        case .requestEnable:
            guard !next.isKillSwitchEnabled else {
                next.mode = .readOnly
                next.phase = .blockedByKillSwitch
                next.lastErrorCode = Self.killSwitchBlockedErrorCode
                return next
            }
            guard next.mode != .enabled else {
                next.phase = .idle
                return next
            }
            next.phase = .pendingEnable
            next.lastErrorCode = nil

        case .requestDisable:
            guard next.mode == .enabled else {
                return next
            }
            next.phase = .pendingDisable
            next.lastErrorCode = nil

        case .ackEnable:
            guard next.phase == .pendingEnable else {
                return next
            }
            next.mode = .enabled
            next.phase = .idle
            next.lastErrorCode = nil

        case .ackDisable:
            guard next.phase == .pendingDisable || next.phase == .blockedByKillSwitch else {
                return next
            }
            next.mode = .readOnly
            next.phase = .idle
            next.lastErrorCode = nil

        case let .requestFailed(errorCode):
            guard next.phase == .pendingEnable || next.phase == .pendingDisable else {
                return next
            }
            next.phase = .failed
            next.lastErrorCode = errorCode
        }

        return next
    }
}
