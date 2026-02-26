import assert from "node:assert/strict";
import test from "node:test";
import { loadProxySettings, ProxyUndiciDispatcherFactory } from "../src/index.js";

test("default adapter returns Undici-compatible dispatcher for direct route", () => {
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({})
  });
  try {
    const result = factory.resolve("https://service.local");
    assert.equal(result.viaProxy, false);
    assert.equal(typeof (result.dispatcher as { dispatch?: unknown }).dispatch, "function");
  } finally {
    factory.destroy();
  }
});

test("default adapter returns Undici-compatible dispatcher for proxy route", () => {
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({ https_proxy: "http://proxy.local:8080" })
  });
  try {
    const result = factory.resolve("https://service.local");
    assert.equal(result.viaProxy, true);
    assert.equal(result.proxyUrl, "http://proxy.local:8080/");
    assert.equal(typeof (result.dispatcher as { dispatch?: unknown }).dispatch, "function");
  } finally {
    factory.destroy();
  }
});
