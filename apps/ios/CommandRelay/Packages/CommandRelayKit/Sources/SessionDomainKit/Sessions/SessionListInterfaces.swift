import Foundation

/// Basic terminal session metadata for list rendering.
public struct RelaySessionSummary: Sendable, Equatable, Identifiable {
    /// Stable session identifier.
    public let id: String

    /// Human-readable session name.
    public let title: String

    /// Host label shown in list subtitles.
    public let host: String

    /// Whether this session currently allows input.
    public let readOnly: Bool

    /// Creates a session summary model.
    /// - Parameters:
    ///   - id: Stable session identifier.
    ///   - title: Session title.
    ///   - host: Remote host label.
    ///   - readOnly: Read-only status.
    public init(id: String, title: String, host: String, readOnly: Bool) {
        self.id = id
        self.title = title
        self.host = host
        self.readOnly = readOnly
    }
}

/// Input model for session list queries.
public struct SessionListQuery: Sendable, Equatable {
    /// Optional text filter.
    public let searchText: String

    /// Includes archived sessions when true.
    public let includeArchived: Bool

    /// Creates a list query.
    /// - Parameters:
    ///   - searchText: Optional search text.
    ///   - includeArchived: Include archived rows.
    public init(searchText: String = "", includeArchived: Bool = false) {
        self.searchText = searchText
        self.includeArchived = includeArchived
    }
}

/// Read-only session discovery use case.
public protocol SessionListServicing: Sendable {
    /// Returns visible sessions sorted server-side.
    /// - Parameter query: Filter and option payload.
    func listSessions(query: SessionListQuery) async throws -> [RelaySessionSummary]
}
