import assert from "node:assert/strict";
import test from "node:test";
import * as proxyFetch from "../src/index.js";

test("root exports expose stable proxy-fetch API", () => {
  assert.equal(typeof proxyFetch.ProxyFetchClient, "function");
  assert.equal(typeof proxyFetch.createProxyFetchClient, "function");
  assert.equal(typeof proxyFetch.proxyFetch, "function");
  assert.equal(typeof proxyFetch.proxyFetchJson, "function");

  assert.equal(typeof proxyFetch.InvalidUrlError, "function");
  assert.equal(typeof proxyFetch.NonJsonResponseError, "function");
  assert.equal(typeof proxyFetch.RequestTimeoutError, "function");
  assert.equal(typeof proxyFetch.ResponseSizeLimitError, "function");

  assert.equal(typeof proxyFetch.loadProxySettings, "function");
  assert.equal(typeof proxyFetch.resolveProxyForUrl, "function");
  assert.equal(typeof proxyFetch.shouldBypassProxy, "function");
});
