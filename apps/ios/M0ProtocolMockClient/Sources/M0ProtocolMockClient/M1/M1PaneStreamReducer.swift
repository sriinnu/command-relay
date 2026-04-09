import Foundation

/// Transport/attach state for a pane output stream.
public enum M1PaneConnectionState: String, Equatable, Sendable {
    /// Pane has not started attach flow.
    case idle

    /// Attach flow is in progress.
    case attaching

    /// Pane is actively attached and receiving stream events.
    case attached

    /// Transport is reconnecting this pane.
    case reconnecting

    /// Pane is detached and not receiving events.
    case detached
}

/// Immutable view state for the iOS M1 read-only pane stream.
public struct M1PaneStreamState: Equatable, Sendable {
    /// Target pane identifier.
    public var paneID: String

    /// Current connection lifecycle state.
    public var connectionState: M1PaneConnectionState

    /// Last known server session identifier from `connected` events.
    public var sessionID: String?

    /// Aggregated pane output text.
    public var output: String

    /// Last successfully applied stream sequence.
    public var lastAppliedSeq: UInt64?

    /// Set when a non-contiguous sequence is observed.
    public var hasSequenceGap: Bool

    /// Last status payload emitted by stream events.
    public var lastStatus: M0StatusEvent?

    /// Last heartbeat server timestamp in milliseconds.
    public var lastHeartbeatMs: UInt64?

    /// Last reconnect attempt index reported by transport hooks.
    public var reconnectAttempt: Int

    /// Read-only mode flag. Reducer enforces this to remain `true`.
    public var isReadOnly: Bool

    /// Creates pane stream state.
    /// - Parameters:
    ///   - paneID: Target pane identifier.
    ///   - connectionState: Initial connection state.
    ///   - sessionID: Initial server session identifier.
    ///   - output: Initial output text.
    ///   - lastAppliedSeq: Initial stream sequence cursor.
    ///   - hasSequenceGap: Initial gap indicator.
    ///   - lastStatus: Initial stream status payload.
    ///   - lastHeartbeatMs: Initial heartbeat timestamp.
    ///   - reconnectAttempt: Initial reconnect attempt.
    ///   - isReadOnly: Initial read-only flag.
    public init(
        paneID: String,
        connectionState: M1PaneConnectionState = .idle,
        sessionID: String? = nil,
        output: String = "",
        lastAppliedSeq: UInt64? = nil,
        hasSequenceGap: Bool = false,
        lastStatus: M0StatusEvent? = nil,
        lastHeartbeatMs: UInt64? = nil,
        reconnectAttempt: Int = 0,
        isReadOnly: Bool = true
    ) {
        self.paneID = paneID
        self.connectionState = connectionState
        self.sessionID = sessionID
        self.output = output
        self.lastAppliedSeq = lastAppliedSeq
        self.hasSequenceGap = hasSequenceGap
        self.lastStatus = lastStatus
        self.lastHeartbeatMs = lastHeartbeatMs
        self.reconnectAttempt = reconnectAttempt
        self.isReadOnly = isReadOnly
    }
}

/// User and transport actions consumed by the pane stream reducer.
public enum M1PaneStreamAction: Equatable, Sendable {
    /// User selected a pane to attach.
    case attachRequested(paneID: String)

    /// Transport attach handshake completed.
    case attachConfirmed

    /// One typed protocol envelope was received.
    case receiveEnvelope(M0Envelope<M0Event>)

    /// Transport moved into reconnecting mode.
    case reconnecting(attempt: Int)

    /// Transport reconnected and resumed stream flow.
    case reconnectSucceeded

    /// User or app lifecycle requested detach.
    case detached

    /// Clears rendered output while keeping stream metadata.
    case clearOutput
}

/// Pure reducer that applies stream actions to pane view state.
public struct M1PaneStreamReducer: Sendable {
    /// Creates the reducer.
    public init() {}

    /// Applies one action and returns next pane state.
    /// - Parameters:
    ///   - state: Current pane stream state.
    ///   - action: Action to apply.
    /// - Returns: Next pane stream state.
    public func reduce(state: M1PaneStreamState, action: M1PaneStreamAction) -> M1PaneStreamState {
        var next = state

        switch action {
        case let .attachRequested(paneID):
            next = applyAttachRequested(to: next, paneID: paneID)
        case .attachConfirmed:
            next.connectionState = .attached
            next.reconnectAttempt = 0
        case let .receiveEnvelope(envelope):
            next = applyEnvelope(envelope, to: next)
        case let .reconnecting(attempt):
            next.connectionState = .reconnecting
            next.reconnectAttempt = max(0, attempt)
        case .reconnectSucceeded:
            next.connectionState = .attached
            next.reconnectAttempt = 0
        case .detached:
            next.connectionState = .detached
            next.reconnectAttempt = 0
        case .clearOutput:
            next.output = ""
            next.hasSequenceGap = false
        }

        // M1 safety invariant: stream layer remains read-only by default.
        next.isReadOnly = true
        return next
    }

    private func applyAttachRequested(to state: M1PaneStreamState, paneID: String) -> M1PaneStreamState {
        var next = state
        let trimmedPaneID = paneID.trimmingCharacters(in: .whitespacesAndNewlines)

        if !trimmedPaneID.isEmpty, next.paneID != trimmedPaneID {
            next.paneID = trimmedPaneID
            next.output = ""
            next.lastAppliedSeq = nil
            next.hasSequenceGap = false
            next.lastStatus = nil
            next.lastHeartbeatMs = nil
            next.sessionID = nil
        }

        next.connectionState = .attaching
        next.reconnectAttempt = 0
        return next
    }

    private func applyEnvelope(
        _ envelope: M0Envelope<M0Event>,
        to state: M1PaneStreamState
    ) -> M1PaneStreamState {
        var next = state

        guard envelope.streamID == next.paneID else {
            return next
        }

        if let lastSeq = next.lastAppliedSeq, envelope.streamSeq <= lastSeq {
            return next
        }

        if let lastSeq = next.lastAppliedSeq, envelope.streamSeq != lastSeq + 1 {
            next.hasSequenceGap = true
        }

        next.lastAppliedSeq = envelope.streamSeq

        switch envelope.event {
        case let .connected(event):
            next.sessionID = event.sessionID
            next.connectionState = .attached
        case let .outputChunk(event):
            next.output.append(event.chunk)
        case let .status(event):
            next.lastStatus = event
        case let .heartbeat(event):
            next.lastHeartbeatMs = event.serverTimeMs
        }

        return next
    }
}
