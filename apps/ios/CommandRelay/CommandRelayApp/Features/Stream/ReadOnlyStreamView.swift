import SessionDomainKit
import SwiftUI

/// Effective local policy state for command input on the stream screen.
enum StreamInputPolicy: Equatable {
    case disabled
    case enabled
    case globallyBlocked

    var badgeTitle: String {
        switch self {
        case .disabled:
            return "Input Disabled"
        case .enabled:
            return "Input Enabled"
        case .globallyBlocked:
            return "Input Blocked"
        }
    }

    var detailText: String {
        switch self {
        case .disabled:
            return "Read-only mode. Enable input to send commands."
        case .enabled:
            return "Controlled input is active for this device."
        case .globallyBlocked:
            return "Input is blocked by global safety policy."
        }
    }

    var symbolName: String {
        switch self {
        case .disabled:
            return "lock"
        case .enabled:
            return "lock.open"
        case .globallyBlocked:
            return "exclamationmark.shield"
        }
    }

    var canEnableInput: Bool {
        self != .globallyBlocked
    }
}

/// Async send state for composer feedback.
enum StreamSendState: Equatable {
    case idle
    case pending
    case success(String)
    case error(String)

    var message: String? {
        switch self {
        case .idle:
            return nil
        case .pending:
            return "Sending command..."
        case let .success(message), let .error(message):
            return message
        }
    }

    var isPending: Bool {
        if case .pending = self {
            return true
        }
        return false
    }

    var isError: Bool {
        if case .error = self {
            return true
        }
        return false
    }
}

/// View model that drives read-only stream output and gated command input UX.
@MainActor
final class ReadOnlyStreamViewModel: ObservableObject {
    @Published private(set) var transcript = ""
    @Published private(set) var statusText = "Detached"
    @Published private(set) var lastSequence: Int64 = 0
    @Published private(set) var isAttached = false
    @Published private(set) var inputPolicy: StreamInputPolicy
    @Published var commandDraft = ""
    @Published private(set) var sendState: StreamSendState = .idle

    private let streamService: any ReadOnlyStreamServicing
    private let inputService: any ControlledInputServicing
    private let isGlobalInputBlocked: Bool
    private var activeStreamTask: Task<Void, Never>?
    private let actor = InputAuditActor(actorID: "ios-client", displayName: "iOS App")

    /// Creates the stream view model.
    /// - Parameters:
    ///   - streamService: Service for stream attach/detach lifecycle.
    ///   - inputService: Service for controlled input enable/disable/send.
    ///   - isGlobalInputBlocked: Optional override for tests/previews.
    init(
        streamService: any ReadOnlyStreamServicing,
        inputService: any ControlledInputServicing,
        isGlobalInputBlocked: Bool = Self.resolveGlobalInputBlocked()
    ) {
        self.streamService = streamService
        self.inputService = inputService
        self.isGlobalInputBlocked = isGlobalInputBlocked
        self.inputPolicy = isGlobalInputBlocked ? .globallyBlocked : .disabled
    }

    /// Attaches to a pane/session and starts consuming stream output.
    /// - Parameter sessionID: Pane/session identifier.
    func attach(sessionID: String) async {
        activeStreamTask?.cancel()
        transcript = ""
        statusText = "Attaching..."
        isAttached = false
        sendState = .idle
        inputPolicy = isGlobalInputBlocked ? .globallyBlocked : .disabled

        do {
            let stream = try await streamService.attach(
                request: StreamAttachRequest(sessionID: sessionID, cursor: StreamCursor(lastSequence: lastSequence))
            )

            activeStreamTask = Task { [weak self] in
                guard let self else { return }
                do {
                    self.statusText = "Live stream"
                    self.isAttached = true
                    for try await chunk in stream {
                        self.lastSequence = chunk.sequence
                        if chunk.mode == .snapshot {
                            self.transcript = chunk.text
                        } else {
                            self.transcript += chunk.text
                        }
                    }
                    self.isAttached = false
                    self.statusText = "Detached"
                } catch {
                    self.isAttached = false
                    self.statusText = "Stream error: \(error.localizedDescription)"
                }
            }
        } catch {
            isAttached = false
            statusText = "Stream error: \(error.localizedDescription)"
        }
    }

    /// Detaches from the active pane/session stream.
    /// - Parameter sessionID: Pane/session identifier.
    func detach(sessionID: String) async {
        activeStreamTask?.cancel()
        activeStreamTask = nil
        isAttached = false
        await disableInput(sessionID: sessionID, reason: "detach")
        await streamService.detach(sessionID: sessionID)
        statusText = "Detached"
    }

    /// Enables input after user confirms the risk gate.
    func enableInput(sessionID: String) async {
        guard !isGlobalInputBlocked else {
            inputPolicy = .globallyBlocked
            sendState = .error("Input is globally blocked and cannot be enabled.")
            return
        }
        do {
            let state = try await inputService.enableInput(
                request: EnableInputRequest(
                    sessionID: sessionID,
                    actor: actor,
                    reason: "operator_confirmed_enable_input"
                )
            )
            inputPolicy = Self.mapPolicy(mode: state.mode, globalInputDisabled: state.globalInputDisabled)
            sendState = .idle
        } catch {
            sendState = .error(error.localizedDescription)
        }
    }

    /// Disables controlled input and resets composer status.
    func disableInput(sessionID: String, reason: String? = nil) async {
        do {
            let state = try await inputService.disableInput(
                request: DisableInputRequest(
                    sessionID: sessionID,
                    actor: actor,
                    reason: reason
                )
            )
            inputPolicy = Self.mapPolicy(mode: state.mode, globalInputDisabled: state.globalInputDisabled)
            sendState = .idle
        } catch {
            // Safe fallback keeps UI read-only even when disable call fails.
            inputPolicy = isGlobalInputBlocked ? .globallyBlocked : .disabled
            sendState = .idle
        }
    }

    /// Attempts to send a command through the controlled-input workflow.
    /// - Parameter sessionID: Pane/session identifier to target.
    func sendCommand(sessionID: String) async {
        let trimmedCommand = commandDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCommand.isEmpty else {
            sendState = .error("Enter a command before sending.")
            return
        }

        guard isAttached else {
            sendState = .error("Attach to a pane before sending commands.")
            return
        }

        guard inputPolicy == .enabled else {
            sendState = .error("Input is disabled by policy.")
            return
        }

        sendState = .pending

        do {
            let payload = trimmedCommand.hasSuffix("\n") ? trimmedCommand : "\(trimmedCommand)\n"
            let audit = try await inputService.sendInput(
                request: SendInputRequest(
                    sessionID: sessionID,
                    actor: actor,
                    payload: SessionInputPayload(text: payload)
                )
            )
            transcript += "\n$ \(trimmedCommand)\n"
            commandDraft = ""
            sendState = .success("Command sent (\(audit.id.prefix(8))).")
        } catch {
            sendState = .error(error.localizedDescription)
        }
    }

    var canEditCommand: Bool {
        isAttached && inputPolicy == .enabled && !sendState.isPending
    }

    var canEnableInput: Bool {
        inputPolicy.canEnableInput && !isGlobalInputBlocked
    }

    var isGloballyBlocked: Bool {
        inputPolicy == .globallyBlocked
    }

    private static func mapPolicy(mode: InputControlMode, globalInputDisabled: Bool) -> StreamInputPolicy {
        if globalInputDisabled {
            return .globallyBlocked
        }
        return mode == .enabled ? .enabled : .disabled
    }

    private static func resolveGlobalInputBlocked() -> Bool {
        let rawValue = ProcessInfo.processInfo.environment["COMMANDRELAY_INPUT_KILL_SWITCH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let blockedValues: Set<String> = ["1", "true", "yes", "on"]
        return rawValue.map { blockedValues.contains($0) } ?? false
    }
}

/// Stream screen with read-only transcript and risk-gated controlled input actions.
struct ReadOnlyStreamView: View {
    @StateObject private var viewModel: ReadOnlyStreamViewModel
    @AppStorage("commandrelay.selectedPaneId") private var sessionID = "%1"
    @State private var showsEnableInputConfirmation = false
    @FocusState private var isComposerFocused: Bool

    /// Creates the read-only stream view.
    /// - Parameters:
    ///   - streamService: Stream attach/detach service.
    ///   - inputService: Controlled input service.
    init(
        streamService: any ReadOnlyStreamServicing,
        inputService: any ControlledInputServicing
    ) {
        _viewModel = StateObject(
            wrappedValue: ReadOnlyStreamViewModel(
                streamService: streamService,
                inputService: inputService
            )
        )
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

                policySection

                ScrollView {
                    Text(viewModel.transcript)
                        .font(.system(.body, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                composerSection

                HStack {
                    Button("Attach") {
                        Task { await viewModel.attach(sessionID: sessionID) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button("Detach") {
                        Task { await viewModel.detach(sessionID: sessionID) }
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding()
            .navigationTitle("Read-Only Stream")
        }
        .confirmationDialog(
            "Enable Controlled Input?",
            isPresented: $showsEnableInputConfirmation,
            titleVisibility: .visible
        ) {
            Button("Enable Input", role: .destructive) {
                Task {
                    await viewModel.enableInput(sessionID: sessionID)
                    isComposerFocused = true
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Commands execute on the attached pane. Continue only for sessions you trust.")
        }
    }

    private var policySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: viewModel.inputPolicy.symbolName)
                    .imageScale(.small)
                Text(viewModel.inputPolicy.badgeTitle)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if viewModel.inputPolicy == .enabled {
                    Button("Disable Input") {
                        Task { await viewModel.disableInput(sessionID: sessionID) }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                } else {
                    Button("Enable Input") {
                        showsEnableInputConfirmation = true
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(!viewModel.canEnableInput)
                }
            }

            Text(viewModel.inputPolicy.detailText)
                .font(.caption)
                .foregroundStyle(viewModel.isGloballyBlocked ? .red : .secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }

    private var composerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Command Composer")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)

            TextField("Type a command", text: $viewModel.commandDraft, axis: .vertical)
                .lineLimit(1 ... 3)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .disabled(!viewModel.canEditCommand)
                .focused($isComposerFocused)
                .accessibilityLabel("Command input")
                .accessibilityHint("Type a terminal command to send to the attached pane.")
                .onSubmit {
                    Task { await viewModel.sendCommand(sessionID: sessionID) }
                }

            HStack {
                Button {
                    Task { await viewModel.sendCommand(sessionID: sessionID) }
                } label: {
                    if viewModel.sendState.isPending {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Label("Send", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.canEditCommand || viewModel.commandDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if let message = viewModel.sendState.message {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(viewModel.sendState.isError ? .red : .secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.black.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
