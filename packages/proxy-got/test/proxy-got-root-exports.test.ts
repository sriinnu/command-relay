import assert from "node:assert/strict";
import test from "node:test";
import * as proxyGot from "../src/index.js";

test("root exports expose stable proxy-got API", () => {
  assert.equal(typeof proxyGot.ProxyGotAgentResolver, "function");
  assert.equal(typeof proxyGot.createProxyGotAgentResolver, "function");
  assert.equal(typeof proxyGot.resolveGotRequestTarget, "function");
  assert.equal(typeof proxyGot.resolveProxyGotAgentEntry, "function");
  assert.equal(typeof proxyGot.applyProxyGotAgent, "function");

  assert.equal(typeof proxyGot.MissingGotTargetError, "function");
  assert.equal(typeof proxyGot.InvalidGotTargetError, "function");
  assert.equal(typeof proxyGot.InvalidGotPrefixUrlError, "function");
  assert.equal(typeof proxyGot.UnsupportedGotProtocolError, "function");

  assert.equal(typeof proxyGot.loadProxySettings, "function");
  assert.equal(typeof proxyGot.resolveProxyForUrl, "function");
  assert.equal(typeof proxyGot.parseNoProxy, "function");
  assert.equal(typeof proxyGot.shouldBypassProxy, "function");
});
