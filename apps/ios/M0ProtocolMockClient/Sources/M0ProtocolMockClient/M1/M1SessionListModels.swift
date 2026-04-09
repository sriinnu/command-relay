import Foundation

/// Presence status for a remote session row.
public enum M1SessionPresence: String, Codable, Equatable, Sendable {
    /// Session is currently reachable.
    case online

    /// Session is temporarily unavailable.
    case degraded

    /// Session is not currently reachable.
    case offline
}

/// Read-only pane metadata used by iOS M1 session browsing.
public struct M1PaneSummary: Codable, Equatable, Identifiable, Sendable {
    /// Stable pane identifier.
    public let id: String

    /// Human-readable pane label.
    public let title: String

    /// Stream identifier used by the protocol layer.
    public let streamID: String

    /// Last known output sequence for this pane.
    public let lastSeq: UInt64?

    /// Whether this pane is currently active in the parent session.
    public let isActive: Bool

    /// Pane-level policy indicator used by read-only UI badges.
    public let readOnly: Bool

    /// Creates pane summary metadata.
    /// - Parameters:
    ///   - id: Stable pane identifier.
    ///   - title: Human-readable pane label.
    ///   - streamID: Stream identifier for attach/replay.
    ///   - lastSeq: Last known output sequence.
    ///   - isActive: Active pane flag.
    ///   - readOnly: Read-only policy flag.
    public init(
        id: String,
        title: String,
        streamID: String,
        lastSeq: UInt64?,
        isActive: Bool,
        readOnly: Bool = true
    ) {
        self.id = id
        self.title = title
        self.streamID = streamID
        self.lastSeq = lastSeq
        self.isActive = isActive
        self.readOnly = readOnly
    }
}

/// Session-level list model for iOS M1 read-only workflows.
public struct M1SessionSummary: Codable, Equatable, Identifiable, Sendable {
    /// Stable session identifier.
    public let id: String

    /// Human-readable session title.
    public let title: String

    /// Host label used in subtitles and filters.
    public let host: String

    /// Session presence status.
    public let presence: M1SessionPresence

    /// Session-level read-only policy flag.
    public let readOnly: Bool

    /// Panes available for attach/read-only streaming.
    public let panes: [M1PaneSummary]

    /// Creates a session summary.
    /// - Parameters:
    ///   - id: Stable session identifier.
    ///   - title: Session title.
    ///   - host: Host label.
    ///   - presence: Current connectivity status.
    ///   - readOnly: Session read-only policy state.
    ///   - panes: Pane summaries for attach options.
    public init(
        id: String,
        title: String,
        host: String,
        presence: M1SessionPresence,
        readOnly: Bool = true,
        panes: [M1PaneSummary]
    ) {
        self.id = id
        self.title = title
        self.host = host
        self.presence = presence
        self.readOnly = readOnly
        self.panes = panes
    }

    /// Number of panes available for this session.
    public var paneCount: Int {
        panes.count
    }

    /// Returns whether the session matches user-entered search text.
    ///
    /// Search matches against session `title`, `host`, `id`, and pane `title`/`id`.
    /// - Parameter searchText: Free-text query entered by the user.
    /// - Returns: `true` when any indexed field matches.
    public func matches(searchText: String) -> Bool {
        let needle = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return true }

        if title.localizedCaseInsensitiveContains(needle) { return true }
        if host.localizedCaseInsensitiveContains(needle) { return true }
        if id.localizedCaseInsensitiveContains(needle) { return true }

        return panes.contains {
            $0.title.localizedCaseInsensitiveContains(needle) ||
                $0.id.localizedCaseInsensitiveContains(needle)
        }
    }
}

/// Deterministic query model for filtering a session list slice.
public struct M1SessionListQuery: Equatable, Sendable {
    /// Optional free-text search input.
    public let searchText: String

    /// Includes `.offline` rows when true.
    public let includeOffline: Bool

    /// Creates a list query.
    /// - Parameters:
    ///   - searchText: Free-text filter.
    ///   - includeOffline: Include offline sessions.
    public init(searchText: String = "", includeOffline: Bool = false) {
        self.searchText = searchText
        self.includeOffline = includeOffline
    }

    /// Applies filtering and deterministic sorting to session rows.
    /// - Parameter sessions: Candidate session rows.
    /// - Returns: Filtered and sorted rows.
    public func apply(to sessions: [M1SessionSummary]) -> [M1SessionSummary] {
        sessions
            .filter { session in
                if !includeOffline && session.presence == .offline {
                    return false
                }
                return session.matches(searchText: searchText)
            }
            .sorted(by: Self.compareSessions)
    }

    private static func compareSessions(lhs: M1SessionSummary, rhs: M1SessionSummary) -> Bool {
        let lhsRank = rank(for: lhs.presence)
        let rhsRank = rank(for: rhs.presence)

        if lhsRank != rhsRank {
            return lhsRank < rhsRank
        }

        let titleOrdering = lhs.title.localizedCaseInsensitiveCompare(rhs.title)
        if titleOrdering != .orderedSame {
            return titleOrdering == .orderedAscending
        }

        return lhs.id.localizedCaseInsensitiveCompare(rhs.id) == .orderedAscending
    }

    private static func rank(for presence: M1SessionPresence) -> Int {
        switch presence {
        case .online:
            return 0
        case .degraded:
            return 1
        case .offline:
            return 2
        }
    }
}
