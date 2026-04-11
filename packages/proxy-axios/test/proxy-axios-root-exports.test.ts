import assert from "node:assert/strict";
import test from "node:test";
import * as proxyAxios from "../src/index.js";

test("root exports expose stable proxy-axios API", () => {
  assert.equal(typeof proxyAxios.ProxyAxiosAgentResolver, "function");
  assert.equal(typeof proxyAxios.resolveAxiosRequestTarget, "function");
  assert.equal(typeof proxyAxios.resolveProxyAxiosAgent, "function");
  assert.equal(typeof proxyAxios.applyProxyAgentToAxiosConfig, "function");

  assert.equal(typeof proxyAxios.loadProxySettings, "function");
  assert.equal(typeof proxyAxios.parseNoProxy, "function");
  assert.equal(typeof proxyAxios.resolveProxyForUrl, "function");
  assert.equal(typeof proxyAxios.shouldBypassProxy, "function");
});
