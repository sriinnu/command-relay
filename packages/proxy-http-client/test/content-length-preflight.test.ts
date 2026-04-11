import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as nodeHttp from "node:http";
import test from "node:test";
import {
  ResponseSizeLimitError,
  requestJson,
  type JsonRequestTransport
} from "../src/index.js";

class FakeClientRequest extends EventEmitter {
  readonly options: nodeHttp.RequestOptions;
  private readonly callback: (response: nodeHttp.IncomingMessage) => void;
  private readonly onEnd: (request: FakeClientRequest) => void;
  destroyedError: Error | null = null;

  constructor(
    options: nodeHttp.RequestOptions,
    callback: (response: nodeHttp.IncomingMessage) => void,
    onEnd: (request: FakeClientRequest) => void
  ) {
    super();
    this.options = options;
    this.callback = callback;
    this.onEnd = onEnd;
  }

  end(): void {
    this.onEnd(this);
  }

  destroy(error?: Error): this {
    if (error) {
      this.destroyedError = error;
      this.emit("error", error);
    }
    return this;
  }

  emitRawResponse(
    statusCode: number,
    headers: nodeHttp.IncomingHttpHeaders,
    chunks: string[]
  ): void {
    const response = new EventEmitter() as nodeHttp.IncomingMessage;
    (response as { statusCode?: number }).statusCode = statusCode;
    (response as { headers: nodeHttp.IncomingHttpHeaders }).headers = headers;

    this.callback(response);

    for (const chunk of chunks) {
      response.emit("data", Buffer.from(chunk, "utf8"));
    }

    response.emit("end");
  }
}

test("requestJson fails fast when content-length exceeds maxResponseBytes", async () => {
  const harness = createTransportHarness((request) => {
    request.emitRawResponse(200, { "content-length": "50" }, ["small"]);
  });

  await assert.rejects(
    () =>
      requestJson("http://service.local/preflight-size-check", {
        maxResponseBytes: 10,
        transport: harness.transport
      }),
    (error: unknown) => {
      assert.equal(error instanceof ResponseSizeLimitError, true);
      if (!(error instanceof ResponseSizeLimitError)) {
        return false;
      }
      assert.equal(error.target, "http://service.local/preflight-size-check");
      assert.equal(error.status, 200);
      assert.equal(error.maxBytes, 10);
      assert.equal(error.receivedBytes, 50);
      return true;
    }
  );

  assert.equal(
    harness.getLastRequest().destroyedError instanceof ResponseSizeLimitError,
    true
  );
});

test("requestJson ignores invalid content-length and continues normal parsing", async () => {
  const harness = createTransportHarness((request) => {
    request.emitRawResponse(
      200,
      {
        "content-type": "application/json",
        "content-length": "not-a-number"
      },
      ['{"ok":true}']
    );
  });

  const result = await requestJson<{ ok: boolean }>("http://service.local/invalid-length", {
    maxResponseBytes: 64,
    transport: harness.transport
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
});

function createTransportHarness(
  onRequestEnd: (request: FakeClientRequest) => void
): {
  transport: JsonRequestTransport;
  getLastRequest: () => FakeClientRequest;
} {
  let lastRequest: FakeClientRequest | null = null;

  const requestMock = (
    options: nodeHttp.RequestOptions,
    callback: (response: nodeHttp.IncomingMessage) => void
  ): nodeHttp.ClientRequest => {
    const request = new FakeClientRequest(options, callback, onRequestEnd);
    lastRequest = request;
    return request as unknown as nodeHttp.ClientRequest;
  };

  return {
    transport: {
      httpRequest: requestMock,
      httpsRequest: requestMock
    },
    getLastRequest: () => {
      if (!lastRequest) {
        throw new Error("expected_captured_request");
      }
      return lastRequest;
    }
  };
}
