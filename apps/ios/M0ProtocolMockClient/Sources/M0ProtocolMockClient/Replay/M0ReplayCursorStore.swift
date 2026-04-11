import Foundation

/// In-memory cursor store that tracks the latest acknowledged sequence per stream.
public actor M0ReplayCursorStore {
    private var cursors: [String: UInt64]

    /// Creates a cursor store with optional seed values.
    /// - Parameter seed: Initial stream-to-sequence cursor values.
    public init(seed: [String: UInt64] = [:]) {
        self.cursors = seed
    }

    /// Returns the latest acknowledged sequence for a stream.
    /// - Parameter streamID: Stream identifier.
    /// - Returns: The stored cursor if one exists.
    public func lastSeq(for streamID: String) -> UInt64? {
        cursors[streamID]
    }

    /// Records an acknowledged sequence, keeping the maximum cursor seen.
    /// - Parameters:
    ///   - streamID: Stream identifier.
    ///   - seq: Sequence to acknowledge.
    public func record(streamID: String, seq: UInt64) {
        let current = cursors[streamID] ?? 0
        cursors[streamID] = max(current, seq)
    }

    /// Returns a complete cursor snapshot for diagnostics and tests.
    /// - Returns: Stream cursor map.
    public func snapshot() -> [String: UInt64] {
        cursors
    }
}
