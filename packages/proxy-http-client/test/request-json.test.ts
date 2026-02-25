/**
 * Tests for the proxy-aware JSON HTTP client.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as nodeHttp from "node:http";
import test from "node:test";
import {
  HttpStatusError,
  JsonParseError,
  RequestTimeoutError,
  requestJson,
  type JsonRequestTransport,
  type ProxyAgentResolver
} from "../src/index.js";

class FakeClientRequest extends EventEmitter {
  readonly options: nodeHttp.RequestOptions;
  private readonly callback: (response: nodeHttp.IncomingMessage) => void;
  private readonly onEnd: (request: FakeClientRequest) => void;
  private readonly bodyChunks: Buffer[] = [];
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

  write(chunk: string | Buffer): boolean {
    this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }

  end(chunk?: string | Buffer): void {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.onEnd(this);
  }

  destroy(error?: Error): this {
    if (error) {
      this.destroyedError = error;
      this.emit("error", error);
    }
    return this;
  }

  getBodyText(): string {
    return Buffer.concat(this.bodyChunks).toString("utf8");
  }

  emitJsonResponse(
    statusCode: number,
    body: unknown,
    headers: nodeHttp.IncomingHttpHeaders = {}
  ): void {
    this.emitRawResponse(statusCode, JSON.stringify(body), {
      "content-type": "application/json",
      ...headers
    });
  }

  emitRawResponse(
    statusCode: number,
    rawBody: string,
    headers: nodeHttp.IncomingHttpHeaders = {}
  ): void {
    const response = new EventEmitter() as nodeHttp.IncomingMessage;
    (response as { statusCode?: number }).statusCode = statusCode;
    (response as { headers: nodeHttp.IncomingHttpHeaders }).headers = headers;

    this.callback(response);

    if (rawBody.length > 0) {
      response.emit("data", Buffer.from(rawBody, "utf8"));
    }
    response.emit("end");
  }
}

test("requestJson sends and parses JSON payloads", async () => {
  const harness = createTransportHarness((request) => {
    request.emitJsonResponse(200, { ok: true });
  });

  const result = await requestJson<{ ok: boolean }>("http://service.local/json", {
    method: "post",
    body: { hello: "world" },
    transport: harness.transport
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });

  const request = harness.getLastRequest();
  const headers = (request.options.headers ?? {}) as Record<string, string>;
  assert.equal(request.options.method, "POST");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(request.getBodyText(), '{"hello":"world"}');
});

test("requestJson uses injected proxy agent resolver", async () => {
  const harness = createTransportHarness((request) => {
    request.emitJsonResponse(200, { ok: true });
  });

  const agent = new nodeHttp.Agent();
  const resolvedTargets: string[] = [];

  const resolver: ProxyAgentResolver = {
    resolve(target) {
      resolvedTargets.push(target.toString());
      return { agent };
    }
  };

  const result = await requestJson("http://service.local/proxy", {
    proxyResolver: resolver,
    transport: harness.transport
  });

  assert.equal(result.status, 200);
  assert.equal(resolvedTargets.length, 1);
  assert.equal(harness.getLastRequest().options.agent, agent);
});

test("requestJson uses https transport and async proxy resolver for https targets", async () => {
  let httpCalls = 0;
  let httpsCalls = 0;
  const capturedRequests: FakeClientRequest[] = [];

  const transport: JsonRequestTransport = {
    httpRequest: () => {
      httpCalls += 1;
      throw new Error("unexpected_http_request");
    },
    httpsRequest: (
      options: nodeHttp.RequestOptions,
      callback: (response: nodeHttp.IncomingMessage) => void
    ): nodeHttp.ClientRequest => {
      httpsCalls += 1;
      const request = new FakeClientRequest(options, callback, (capturedRequest) => {
        capturedRequest.emitJsonResponse(200, { ok: true });
      });
      capturedRequests.push(request);
      return request as unknown as nodeHttp.ClientRequest;
    }
  };

  const agent = new nodeHttp.Agent();
  const resolvedTargets: string[] = [];
  const resolver: ProxyAgentResolver = {
    async resolve(target) {
      resolvedTargets.push(target.toString());
      return { agent };
    }
  };

  const result = await requestJson<{ ok: boolean }>("https://service.local/secure", {
    proxyResolver: resolver,
    transport
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(httpCalls, 0);
  assert.equal(httpsCalls, 1);
  assert.deepEqual(resolvedTargets, ["https://service.local/secure"]);
  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0]?.options.agent, agent);
});

test("requestJson rejects unsupported websocket protocols before proxy resolution", async () => {
  let resolveCalls = 0;
  const resolver: ProxyAgentResolver = {
    resolve() {
      resolveCalls += 1;
      return { agent: null };
    }
  };

  await assert.rejects(
    () =>
      requestJson("ws://service.local/socket", {
        proxyResolver: resolver
      }),
    /unsupported_protocol:ws:/
  );
  await assert.rejects(
    () =>
      requestJson("wss://service.local/socket", {
        proxyResolver: resolver
      }),
    /unsupported_protocol:wss:/
  );

  assert.equal(resolveCalls, 0);
});

test("requestJson rejects with RequestTimeoutError on timeout", async () => {
  const harness = createTransportHarness((_request) => {
    // Intentionally no response: requestJson should timeout and destroy the request.
  });

  await assert.rejects(
    () =>
      requestJson("http://service.local/slow", {
        timeoutMs: 20,
        transport: harness.transport
      }),
    (error: unknown) => {
      assert.equal(error instanceof RequestTimeoutError, true);
      assert.equal((error as RequestTimeoutError).timeoutMs, 20);
      return true;
    }
  );

  assert.equal(
    harness.getLastRequest().destroyedError instanceof RequestTimeoutError,
    true
  );
});

test("requestJson rejects with JsonParseError when response is invalid JSON", async () => {
  const harness = createTransportHarness((request) => {
    request.emitRawResponse(200, "not-json", {
      "content-type": "application/json"
    });
  });

  await assert.rejects(
    () =>
      requestJson("http://service.local/invalid-json", {
        transport: harness.transport
      }),
    (error: unknown) => {
      assert.equal(error instanceof JsonParseError, true);
      return true;
    }
  );
});

test("requestJson throws HttpStatusError for HTTP failures by default", async () => {
  const harness = createTransportHarness((request) => {
    request.emitJsonResponse(503, { message: "unavailable" });
  });

  await assert.rejects(
    () =>
      requestJson<{ message: string }>("http://service.local/status", {
        transport: harness.transport
      }),
    (error: unknown) => {
      assert.equal(error instanceof HttpStatusError, true);
      assert.equal((error as HttpStatusError<{ message: string }>).status, 503);
      assert.deepEqual((error as HttpStatusError<{ message: string }>).body, {
        message: "unavailable"
      });
      return true;
    }
  );
});

test("requestJson can return non-2xx responses when throwOnHttpError is false", async () => {
  const harness = createTransportHarness((request) => {
    request.emitJsonResponse(404, { code: "missing" });
  });

  const result = await requestJson<{ code: string }>("http://service.local/not-found", {
    throwOnHttpError: false,
    transport: harness.transport
  });

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { code: "missing" });
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
