import SessionDomainKit
import SwiftUI

@MainActor
final class ReadOnlyStreamViewModel: ObservableObject {
    @Published private(set) var transcript = ""
    @Published private(set) var statusText = "Detached"
    @Published private(set) var lastSequence: Int64 = 0

    private let streamService: any ReadOnlyStreamServicing
    private var activeStreamTask: Task<Void, Never>?

    init(streamService: any ReadOnlyStreamServicing) {
        self.streamService = streamService
    }

    func attach(sessionID: String) async {
        activeStreamTask?.cancel()
        transcript = ""
        statusText = "Attaching..."

        do {
            let stream = try await streamService.attach(
                request: StreamAttachRequest(sessionID: sessionID, cursor: StreamCursor(lastSequence: lastSequence))
            )

            activeStreamTask = Task { [weak self] in
                guard let self else { return }
                do {
                    self.statusText = "Live stream"
                    for try await chunk in stream {
                        self.lastSequence = chunk.sequence
                        if chunk.mode == .snapshot {
                            self.transcript = chunk.text
                        } else {
                            self.transcript += chunk.text
                        }
                    }
                    self.statusText = "Detached"
                } catch {
                    self.statusText = "Stream error: \(error.localizedDescription)"
                }
            }
        } catch {
            statusText = "Stream error: \(error.localizedDescription)"
        }
    }

    func detach(sessionID: String) async {
        activeStreamTask?.cancel()
        activeStreamTask = nil
        await streamService.detach(sessionID: sessionID)
        statusText = "Detached"
    }
}

struct ReadOnlyStreamView: View {
    @StateObject private var viewModel: ReadOnlyStreamViewModel
    @AppStorage("commandrelay.selectedPaneId") private var sessionID = "%1"

    init(streamService: any ReadOnlyStreamServicing) {
        _viewModel = StateObject(wrappedValue: ReadOnlyStreamViewModel(streamService: streamService))
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Pane ID", text: $sessionID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                Text(viewModel.statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("Last Seq: \(viewModel.lastSequence)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)

                ScrollView {
                    Text(viewModel.transcript)
                        .font(.system(.body, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                HStack {
                    Button("Attach") {
                        Task { await viewModel.attach(sessionID: sessionID) }
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Detach") {
                        Task { await viewModel.detach(sessionID: sessionID) }
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding()
            .navigationTitle("Read-Only Stream")
        }
    }
}
