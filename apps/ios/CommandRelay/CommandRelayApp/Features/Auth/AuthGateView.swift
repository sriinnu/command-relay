import CoreKit
import SessionDomainKit
import SwiftUI

@MainActor
final class AuthGateViewModel: ObservableObject {
    @Published private(set) var deviceIdentity: DeviceIdentity?
    @Published private(set) var statusText = "Not paired"

    private let authService: any AuthSessionServicing

    init(authService: any AuthSessionServicing) {
        self.authService = authService
    }

    func runSamplePairing() async {
        do {
            let endpoint = try RelayEndpoint(
                apiBaseURL: URL(string: "https://relay.example.internal")!,
                webSocketURL: URL(string: "wss://relay.example.internal/ws")!
            )

            let qrCode = PairingQRCode(
                endpoint: endpoint,
                pairingCode: "sample-pair-code",
                expiresAt: Date().addingTimeInterval(300)
            )

            let identity = try await authService.pairDevice(using: qrCode)
            let capabilities = try await authService.fetchCapabilities()

            deviceIdentity = identity
            statusText = capabilities.readOnly ? "Paired (read-only)" : "Paired"
        } catch {
            statusText = "Pairing failed: \(error.localizedDescription)"
        }
    }
}

struct AuthGateView: View {
    @StateObject private var viewModel: AuthGateViewModel

    init(authService: any AuthSessionServicing) {
        _viewModel = StateObject(wrappedValue: AuthGateViewModel(authService: authService))
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Pair Device")
                    .font(.title2.weight(.semibold))

                Text(viewModel.statusText)
                    .foregroundStyle(.secondary)

                if let identity = viewModel.deviceIdentity {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Device ID: \(identity.deviceID)")
                        Text("Name: \(identity.displayName)")
                    }
                    .font(.footnote.monospaced())
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                Button("Run Sample Pairing") {
                    Task { await viewModel.runSamplePairing() }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)

                Spacer()
            }
            .padding()
            .navigationTitle("Auth")
        }
    }
}
