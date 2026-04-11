// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "M0ProtocolMockClient",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "M0ProtocolMockClient",
            targets: ["M0ProtocolMockClient"]
        )
    ],
    targets: [
        .target(
            name: "M0ProtocolMockClient"
        ),
        .testTarget(
            name: "M0ProtocolMockClientTests",
            dependencies: ["M0ProtocolMockClient"]
        )
    ]
)
