import SwiftUI

@main
struct CommandRelayApp: App {
    private let dependencies = AppDependencies.makeDefault()

    var body: some Scene {
        WindowGroup {
            AppRootView(dependencies: dependencies)
        }
    }
}
