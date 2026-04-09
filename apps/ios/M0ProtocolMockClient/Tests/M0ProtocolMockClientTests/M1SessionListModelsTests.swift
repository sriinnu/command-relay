import XCTest
@testable import M0ProtocolMockClient

final class M1SessionListModelsTests: XCTestCase {
    func testQueryExcludesOfflineByDefaultAndSortsByPresenceThenTitle() {
        let sessions = [
            makeSession(id: "2", title: "zeta", host: "h2", presence: .offline),
            makeSession(id: "1", title: "alpha", host: "h1", presence: .degraded),
            makeSession(id: "3", title: "beta", host: "h3", presence: .online)
        ]

        let filtered = M1SessionListQuery().apply(to: sessions)

        XCTAssertEqual(filtered.map(\.id), ["3", "1"])
    }

    func testQuerySearchMatchesSessionAndPaneFields() {
        let sessions = [
            M1SessionSummary(
                id: "session-a",
                title: "Web",
                host: "prod-web-01",
                presence: .online,
                panes: [
                    M1PaneSummary(
                        id: "%1",
                        title: "shell",
                        streamID: "pane-stream-1",
                        lastSeq: 20,
                        isActive: true
                    )
                ]
            ),
            M1SessionSummary(
                id: "session-b",
                title: "Worker",
                host: "prod-worker-02",
                presence: .online,
                panes: [
                    M1PaneSummary(
                        id: "%9",
                        title: "jobs",
                        streamID: "pane-stream-9",
                        lastSeq: 5,
                        isActive: true
                    )
                ]
            )
        ]

        let byHost = M1SessionListQuery(searchText: "worker", includeOffline: true).apply(to: sessions)
        let byPane = M1SessionListQuery(searchText: "%1", includeOffline: true).apply(to: sessions)

        XCTAssertEqual(byHost.map(\.id), ["session-b"])
        XCTAssertEqual(byPane.map(\.id), ["session-a"])
    }

    private func makeSession(
        id: String,
        title: String,
        host: String,
        presence: M1SessionPresence
    ) -> M1SessionSummary {
        M1SessionSummary(
            id: id,
            title: title,
            host: host,
            presence: presence,
            panes: [
                M1PaneSummary(
                    id: "%1",
                    title: "main",
                    streamID: "stream-\(id)",
                    lastSeq: nil,
                    isActive: true
                )
            ]
        )
    }
}
