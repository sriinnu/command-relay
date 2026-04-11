import assert from "node:assert/strict";
import test from "node:test";
import * as proxyRuntime from "../src/index.js";

test("root exports expose stable proxy-runtime API", () => {
  assert.equal(typeof proxyRuntime.ProxyRuntimeController, "function");
  assert.equal(typeof proxyRuntime.createProxyRuntimeController, "function");

  assert.equal(typeof proxyRuntime.loadProxySettings, "function");
  assert.equal(typeof proxyRuntime.parseNoProxy, "function");
  assert.equal(typeof proxyRuntime.resolveProxyForUrl, "function");
  assert.equal(typeof proxyRuntime.shouldBypassProxy, "function");
});
