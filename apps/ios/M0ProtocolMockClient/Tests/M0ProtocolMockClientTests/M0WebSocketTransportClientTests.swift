import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import M0ProtocolMockClient

final class M0WebSocketTransportClientTests: XCTestCase {
    func testReconnectIsScheduledAfterReceiveFailureWithoutNetwork() async {
        let recorder = LifecycleRecorder()
        let policy = M0ReconnectBackoffPolicy(
            initialDelayMs: 100,
            multiplier: 2,
            maxDelayMs: 5_000,
            jitterRatio: 0
        )
        let task = FailingReceiveWebSocketTask()
        let factory = SingleTaskFactory(task: task)
        let pipeline = M0DecodedEventPipeline<M0Event, M0Envelope<M0Event>>.jsonEnvelopePassthrough()

        let client = M0WebSocketTransportClient<M0Event, M0Envelope<M0Event>>(
            request: URLRequest(url: URL(string: "wss://example.com/socket")!),
            taskFactory: factory,
            framer: M0WebSocketFramer(),
            pipeline: pipeline,
            reconnectPolicy: policy,
            resumeRequestProvider: nil,
            envelopeAcknowledgeHandler: nil,
            sleepHook: { _ in throw CancellationError() },
            randomUnitProvider: { 0 }
        )

        await client.start(
            eventHandler: { _ in
                XCTFail("No decoded protocol event should be emitted for this test.")
            },
            lifecycleHandler: { event in
                await recorder.record(event: event)
            }
        )

        let lifecycle = await recorder.snapshot()
        XCTAssertTrue(lifecycle.contains(.connecting))
        XCTAssertTrue(lifecycle.contains(.connected))
        XCTAssertTrue(lifecycle.contains(.disconnected))
        XCTAssertTrue(lifecycle.contains(.reconnectScheduled(attempt: 1, delayMs: 100)))
        XCTAssertEqual(lifecycle.last, .stopped)
        XCTAssertEqual(task.resumeCount, 1)
    }
}

private actor LifecycleRecorder {
    private var events: [M0WebSocketLifecycleEvent] = []

    func record(event: M0WebSocketLifecycleEvent) {
        events.append(event)
    }

    func snapshot() -> [M0WebSocketLifecycleEvent] {
        events
    }
}

private final class FailingReceiveWebSocketTask: M0WebSocketTasking, @unchecked Sendable {
    private(set) var resumeCount = 0

    func resume() {
        resumeCount += 1
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        _ = closeCode
        _ = reason
    }

    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        _ = message
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        throw URLError(.cannotConnectToHost)
    }
}

private struct SingleTaskFactory: M0WebSocketTaskFactory, @unchecked Sendable {
    let task: any M0WebSocketTasking

    func makeTask(for request: URLRequest) -> any M0WebSocketTasking {
        _ = request
        return task
    }
}
