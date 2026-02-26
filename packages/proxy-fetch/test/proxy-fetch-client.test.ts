import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidUrlError,
  NonJsonResponseError,
  ProxyFetchClient,
  RequestTimeoutError,
  ResponseSizeLimitError,
  loadProxySettings,
  proxyFetch,
  proxyFetchJson,
  type ProxyFetchImplementation
} from "../src/index.js";

test("ProxyFetchClient routes directly when no proxy settings are configured", async () => {
  const capturedInits: Array<RequestInit | undefined> = [];
  const client = new ProxyFetchClient({
    settings: loadProxySettings({}),
    fetchImplementation: async (_input, init) => {
      capturedInits.push(init);
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.fetchJson<{ ok: boolean }>("https://service.local/health");

  assert.equal(result.routing.viaProxy, false);
  assert.equal(result.routing.proxyUrl, null);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(typeof (capturedInits[0] as { dispatcher?: unknown }).dispatcher, "object");

  client.destroy();
});

test("ProxyFetchClient routes through proxy when proxy settings match target", async () => {
  const client = new ProxyFetchClient({
    settings: loadProxySettings({
      https_proxy: "http://proxy.local:8080"
    }),
    fetchImplementation: async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });

  const result = await client.fetchJson<{ ok: boolean }>("https://api.example.com/v1");

  assert.equal(result.routing.viaProxy, true);
  assert.equal(result.routing.proxyUrl, "http://proxy.local:8080/");

  client.destroy();
});

test("ProxyFetchClient bypasses proxy when NO_PROXY matches target", async () => {
  const client = new ProxyFetchClient({
    settings: loadProxySettings({
      https_proxy: "http://proxy.local:8080",
      no_proxy: "example.com"
    }),
    fetchImplementation: async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });

  const result = await client.fetchJson("https://api.example.com/v1");

  assert.equal(result.routing.viaProxy, false);
  assert.equal(result.routing.proxyUrl, null);

  client.destroy();
});

test("ProxyFetchClient throws RequestTimeoutError when request exceeds timeout", async () => {
  const hangingFetch: ProxyFetchImplementation = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        return;
      }
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });

  const client = new ProxyFetchClient({
    settings: loadProxySettings({}),
    fetchImplementation: hangingFetch
  });

  await assert.rejects(
    () => client.fetchJson("https://service.local/slow", { timeoutMs: 20 }),
    (error: unknown) => {
      assert.equal(error instanceof RequestTimeoutError, true);
      if (!(error instanceof RequestTimeoutError)) {
        return false;
      }
      assert.equal(error.timeoutMs, 20);
      assert.equal(error.target, "https://service.local/slow");
      return true;
    }
  );

  client.destroy();
});

test("ProxyFetchClient throws ResponseSizeLimitError when content-length exceeds limit", async () => {
  const client = new ProxyFetchClient({
    settings: loadProxySettings({}),
    fetchImplementation: async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "11"
        }
      })
  });

  await assert.rejects(
    () => client.fetchJson("https://service.local/oversized", { maxResponseBytes: 10 }),
    (error: unknown) => {
      assert.equal(error instanceof ResponseSizeLimitError, true);
      if (!(error instanceof ResponseSizeLimitError)) {
        return false;
      }
      assert.equal(error.target, "https://service.local/oversized");
      assert.equal(error.maxBytes, 10);
      assert.equal(error.receivedBytes, 11);
      return true;
    }
  );

  client.destroy();
});

test("ProxyFetchClient throws NonJsonResponseError for non-JSON content type", async () => {
  const client = new ProxyFetchClient({
    settings: loadProxySettings({}),
    fetchImplementation: async () =>
      new Response("plain-text", {
        status: 200,
        headers: { "content-type": "text/plain" }
      })
  });

  await assert.rejects(
    () => client.fetchJson("https://service.local/plain"),
    (error: unknown) => {
      assert.equal(error instanceof NonJsonResponseError, true);
      if (!(error instanceof NonJsonResponseError)) {
        return false;
      }
      assert.equal(error.reason, "invalid_content_type");
      assert.equal(error.contentType, "text/plain");
      return true;
    }
  );

  client.destroy();
});

test("ProxyFetchClient throws NonJsonResponseError for invalid JSON payload", async () => {
  const client = new ProxyFetchClient({
    settings: loadProxySettings({}),
    fetchImplementation: async () =>
      new Response('{"missing":', {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });

  await assert.rejects(
    () => client.fetchJson("https://service.local/broken"),
    (error: unknown) => {
      assert.equal(error instanceof NonJsonResponseError, true);
      if (!(error instanceof NonJsonResponseError)) {
        return false;
      }
      assert.equal(error.reason, "invalid_json");
      return true;
    }
  );

  client.destroy();
});

test("ProxyFetchClient throws InvalidUrlError for malformed URL input", async () => {
  const client = new ProxyFetchClient({
    settings: loadProxySettings({}),
    fetchImplementation: async () => new Response("", { status: 204 })
  });

  await assert.rejects(
    () => client.fetchJson("://bad-url"),
    (error: unknown) => {
      assert.equal(error instanceof InvalidUrlError, true);
      return true;
    }
  );

  client.destroy();
});

test("one-shot helpers support raw and JSON request styles", async () => {
  const fetchImplementation: ProxyFetchImplementation = async (input) => {
    const target = typeof input === "string" ? input : input.toString();
    if (target.endsWith("/raw")) {
      return new Response("raw", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const raw = await proxyFetch("https://service.local/raw", {
    client: {
      settings: loadProxySettings({}),
      fetchImplementation
    }
  });

  const json = await proxyFetchJson<{ ok: boolean }>("https://service.local/json", {
    client: {
      settings: loadProxySettings({}),
      fetchImplementation
    }
  });

  assert.equal(raw.routing.viaProxy, false);
  assert.equal(await raw.response.text(), "raw");
  assert.deepEqual(json.body, { ok: true });
});
