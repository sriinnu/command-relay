import SessionDomainKit
import SwiftUI

@MainActor
final class SessionListViewModel: ObservableObject {
    @Published var searchText = ""
    @Published private(set) var sessions: [RelaySessionSummary] = []
    @Published private(set) var errorText: String?

    private let sessionListService: any SessionListServicing

    init(sessionListService: any SessionListServicing) {
        self.sessionListService = sessionListService
    }

    func loadSessions() async {
        do {
            let query = SessionListQuery(searchText: searchText)
            sessions = try await sessionListService.listSessions(query: query)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}

struct SessionListView: View {
    @StateObject private var viewModel: SessionListViewModel
    @AppStorage("commandrelay.selectedPaneId") private var selectedPaneID = ""

    init(sessionListService: any SessionListServicing) {
        _viewModel = StateObject(wrappedValue: SessionListViewModel(sessionListService: sessionListService))
    }

    var body: some View {
        NavigationStack {
            List(viewModel.sessions) { session in
                Button {
                    selectedPaneID = session.id
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.title)
                                .font(.headline)

                            Text("\(session.host) • \(session.readOnly ? "Read-only" : "Input enabled")")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Text("Pane: \(session.id)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 8)
                        if session.id == selectedPaneID {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    }
                }
            }
            .overlay {
                if viewModel.sessions.isEmpty {
                    ContentUnavailableView("No sessions", systemImage: "rectangle.stack")
                }
            }
            .searchable(text: $viewModel.searchText)
            .onSubmit(of: .search) {
                Task { await viewModel.loadSessions() }
            }
            .task {
                await viewModel.loadSessions()
            }
            .refreshable {
                await viewModel.loadSessions()
            }
            .navigationTitle("Sessions")
            .toolbar {
                Button("Reload") {
                    Task { await viewModel.loadSessions() }
                }
            }
        }
    }
}
