// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "CommandRelayKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "CoreKit", targets: ["CoreKit"]),
        .library(name: "RelayProtocolKit", targets: ["RelayProtocolKit"]),
        .library(name: "TransportKit", targets: ["TransportKit"]),
        .library(name: "SessionDomainKit", targets: ["SessionDomainKit"])
    ],
    targets: [
        .target(
            name: "CoreKit"
        ),
        .target(
            name: "RelayProtocolKit",
            dependencies: ["CoreKit"]
        ),
        .target(
            name: "TransportKit",
            dependencies: ["CoreKit", "RelayProtocolKit"]
        ),
        .target(
            name: "SessionDomainKit",
            dependencies: ["CoreKit", "RelayProtocolKit"]
        ),
        .testTarget(
            name: "CoreKitTests",
            dependencies: ["CoreKit", "SessionDomainKit"]
        )
    ]
)
