import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as nodeHttp from "node:http";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import test from "node:test";
import { requestJson, type JsonRequestTransport } from "../src/index.js";

class FakeClientRequest extends EventEmitter {
  readonly options: nodeHttp.RequestOptions & HttpsRequestOptions;
  private readonly callback: (response: nodeHttp.IncomingMessage) => void;

  constructor(
    options: nodeHttp.RequestOptions & HttpsRequestOptions,
    callback: (response: nodeHttp.IncomingMessage) => void
  ) {
    super();
    this.options = options;
    this.callback = callback;
  }

  end(): void {
    const response = new EventEmitter() as nodeHttp.IncomingMessage;
    (response as { statusCode?: number }).statusCode = 200;
    (response as { headers: nodeHttp.IncomingHttpHeaders }).headers = {
      "content-type": "application/json"
    };

    this.callback(response);
    response.emit("data", Buffer.from('{"ok":true}', "utf8"));
    response.emit("end");
  }

  destroy(error?: Error): this {
    if (error) {
      this.emit("error", error);
    }
    return this;
  }
}

test("requestJson forwards requestOptions while preserving core route fields", async () => {
  let capturedRequest: FakeClientRequest | null = null;

  const transport: JsonRequestTransport = {
    httpRequest: (
      options: nodeHttp.RequestOptions & HttpsRequestOptions,
      callback: (response: nodeHttp.IncomingMessage) => void
    ): nodeHttp.ClientRequest => {
      const request = new FakeClientRequest(options, callback);
      capturedRequest = request;
      return request as unknown as nodeHttp.ClientRequest;
    },
    httpsRequest: (
      options: nodeHttp.RequestOptions & HttpsRequestOptions,
      callback: (response: nodeHttp.IncomingMessage) => void
    ): nodeHttp.ClientRequest => {
      const request = new FakeClientRequest(options, callback);
      capturedRequest = request;
      return request as unknown as nodeHttp.ClientRequest;
    }
  };

  const customLookup = (
    _hostname: string,
    _options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
  ): void => {
    callback(null, "127.0.0.1", 4);
  };

  const response = await requestJson<{ ok: boolean }>("https://service.local/config", {
    method: "GET",
    requestOptions: {
      servername: "alt.service.local",
      lookup: customLookup
    },
    transport
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  const requestOptions = requireCapturedRequest(capturedRequest).options;
  assert.equal(requestOptions.protocol, "https:");
  assert.equal(requestOptions.hostname, "service.local");
  assert.equal(requestOptions.path, "/config");
  assert.equal(requestOptions.servername, "alt.service.local");
  assert.equal(requestOptions.lookup, customLookup);
});

function requireCapturedRequest(
  request: FakeClientRequest | null
): FakeClientRequest {
  if (!request) {
    throw new Error("expected_captured_request");
  }
  return request;
}
