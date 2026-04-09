import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as nodeHttp from "node:http";
import test from "node:test";
import {
  JsonParseError,
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

  emitRawChunksResponse(
    statusCode: number,
    chunks: string[],
    headers: nodeHttp.IncomingHttpHeaders = {}
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

test("requestJson rejects with ResponseSizeLimitError when maxResponseBytes is exceeded", async () => {
  const harness = createTransportHarness((request) => {
    request.emitRawChunksResponse(200, ["12345", "67890", "abcde"]);
  });

  await assert.rejects(
    () =>
      requestJson("http://service.local/size-limit", {
        maxResponseBytes: 10,
        transport: harness.transport
      }),
    (error: unknown) => {
      assert.equal(error instanceof ResponseSizeLimitError, true);
      if (!(error instanceof ResponseSizeLimitError)) {
        return false;
      }
      assert.equal(error.name, "ResponseSizeLimitError");
      assert.equal(error.target, "http://service.local/size-limit");
      assert.equal(error.status, 200);
      assert.equal(error.maxBytes, 10);
      assert.equal(error.receivedBytes, 15);
      return true;
    }
  );

  assert.equal(
    harness.getLastRequest().destroyedError instanceof ResponseSizeLimitError,
    true
  );
});

test("requestJson applies default response size limit when maxResponseBytes is omitted", async () => {
  const harness = createTransportHarness((request) => {
    request.emitRawChunksResponse(200, ["a".repeat(700_000), "b".repeat(400_000)]);
  });

  await assert.rejects(
    () => requestJson("http://service.local/default-size-limit", { transport: harness.transport }),
    (error: unknown) => {
      assert.equal(error instanceof ResponseSizeLimitError, true);
      if (!(error instanceof ResponseSizeLimitError)) {
        return false;
      }
      assert.equal(error.maxBytes, 1_048_576);
      assert.equal(error.receivedBytes, 1_100_000);
      return true;
    }
  );
});

test("requestJson deterministically returns ResponseSizeLimitError on overflow", async () => {
  const harness = createTransportHarness((request) => {
    request.emitRawChunksResponse(200, ["{\"broken\":", "1234567890"]);
  });

  await assert.rejects(
    () =>
      requestJson("http://service.local/deterministic-overflow", {
        maxResponseBytes: 8,
        transport: harness.transport
      }),
    (error: unknown) => {
      assert.equal(error instanceof ResponseSizeLimitError, true);
      assert.equal(error instanceof JsonParseError, false);
      return true;
    }
  );
});

test("exports ResponseSizeLimitError from package root", async () => {
  const module = await import("../src/index.js");
  assert.equal(module.ResponseSizeLimitError, ResponseSizeLimitError);
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
