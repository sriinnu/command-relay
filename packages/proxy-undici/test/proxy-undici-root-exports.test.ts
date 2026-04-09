import assert from "node:assert/strict";
import test from "node:test";
import * as proxyUndici from "../src/index.js";

test("root exports expose stable API surface", () => {
  assert.equal(typeof proxyUndici.ProxyUndiciDispatcherFactory, "function");
  assert.equal(typeof proxyUndici.createProxyUndiciDispatcherFactory, "function");
  assert.equal(typeof proxyUndici.BoundedDispatcherCache, "function");
  assert.equal(typeof proxyUndici.normalizeCacheEntries, "function");
  assert.equal(typeof proxyUndici.InvalidTargetUrlError, "function");
  assert.equal(typeof proxyUndici.InvalidProxyUrlError, "function");
  assert.equal(typeof proxyUndici.UnsupportedProxyProtocolError, "function");
  assert.equal(typeof proxyUndici.UnsupportedTargetProtocolError, "function");
  assert.equal(typeof proxyUndici.loadProxySettings, "function");
  assert.equal(typeof proxyUndici.resolveProxyForUrl, "function");
});
