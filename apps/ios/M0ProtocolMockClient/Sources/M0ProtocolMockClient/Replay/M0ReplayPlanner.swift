import Foundation

/// Computes replay windows and reconnect metadata using `streamSeq` and `lastSeq`.
public struct M0ReplayPlanner: Sendable {
    /// Creates a replay planner.
    public init() {}

    /// Builds a reconnect resume request for a known stream and cursor.
    /// - Parameters:
    ///   - streamID: Stream being resumed.
    ///   - streamSeq: Sequence value to use for the reconnect request.
    ///   - lastSeq: Last processed sequence tracked by the client.
    /// - Returns: Typed resume request.
    public func makeResumeRequest(streamID: String, streamSeq: UInt64, lastSeq: UInt64) -> M0ResumeRequest {
        M0ResumeRequest(streamID: streamID, streamSeq: streamSeq, lastSeq: lastSeq)
    }

    /// Filters and orders events that should be replayed after reconnect.
    /// - Parameters:
    ///   - backlog: Full stream backlog from the mock transport.
    ///   - lastSeq: Last processed sequence from the reconnecting client.
    /// - Returns: Strictly ordered events with sequence greater than `lastSeq`.
    public func replayEvents(
        from backlog: [M0Envelope<M0Event>],
        lastSeq: UInt64
    ) -> [M0Envelope<M0Event>] {
        backlog
            .filter { $0.streamSeq > lastSeq }
            .sorted { lhs, rhs in lhs.streamSeq < rhs.streamSeq }
    }
}
