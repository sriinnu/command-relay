import SwiftUI

struct AppRootView: View {
    let dependencies: AppDependencies

    var body: some View {
        TabView {
            AuthGateView(authService: dependencies.authService)
                .tabItem {
                    Label("Auth", systemImage: "lock.shield")
                }

            SessionListView(sessionListService: dependencies.sessionsService)
                .tabItem {
                    Label("Sessions", systemImage: "list.bullet.rectangle")
                }

            ReadOnlyStreamView(
                streamService: dependencies.streamService,
                inputService: dependencies.inputService
            )
                .tabItem {
                    Label("Stream", systemImage: "terminal")
                }
        }
    }
}
