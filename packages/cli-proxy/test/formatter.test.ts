import assert from "node:assert/strict";
import test from "node:test";

import {
  formatEnvironmentInspectionHuman,
  formatExplainRoutesHuman,
  formatHelpText,
  formatJson,
  formatParseError
} from "../src/formatter.js";
import type {
  ExplainRoutesResult,
  ProxyEnvironmentInspection
} from "../src/types.js";

test("formats help text with key commands", () => {
  const output = formatHelpText();

  assert.equal(output.includes("commandrelay-cli-proxy env"), true);
  assert.equal(output.includes("commandrelay-cli-proxy explain"), true);
});

test("formats parse errors with hints", () => {
  const output = formatParseError({
    code: "unknown_option",
    message: "Unknown option",
    hint: "Use --help"
  });

  assert.equal(output.includes("Error: Unknown option"), true);
  assert.equal(output.includes("Hint: Use --help"), true);
});

test("formats environment inspection in human mode", () => {
  const inspection: ProxyEnvironmentInspection = {
    cgiMode: false,
    variables: {
      http_proxy: "proxy.local:8080",
      HTTP_PROXY: null,
      https_proxy: null,
      HTTPS_PROXY: null,
      all_proxy: null,
      ALL_PROXY: null,
      no_proxy: "internal.local",
      NO_PROXY: null,
      REQUEST_METHOD: null,
      request_method: null
    },
    resolution: [
      {
        logicalName: "httpProxy",
        selectedKey: "http_proxy",
        selectedValue: "proxy.local:8080",
        lowerKey: "http_proxy",
        lowerValue: "proxy.local:8080",
        upperKey: "HTTP_PROXY",
        upperValue: null,
        ignoredUppercase: false
      },
      {
        logicalName: "httpsProxy",
        selectedKey: null,
        selectedValue: null,
        lowerKey: "https_proxy",
        lowerValue: null,
        upperKey: "HTTPS_PROXY",
        upperValue: null,
        ignoredUppercase: false
      },
      {
        logicalName: "allProxy",
        selectedKey: null,
        selectedValue: null,
        lowerKey: "all_proxy",
        lowerValue: null,
        upperKey: "ALL_PROXY",
        upperValue: null,
        ignoredUppercase: false
      },
      {
        logicalName: "noProxy",
        selectedKey: "no_proxy",
        selectedValue: "internal.local",
        lowerKey: "no_proxy",
        lowerValue: "internal.local",
        upperKey: "NO_PROXY",
        upperValue: null,
        ignoredUppercase: false
      }
    ],
    settings: {
      httpProxy: "http://proxy.local:8080/",
      httpsProxy: null,
      allProxy: null,
      noProxy: [{ host: "internal.local", port: null, matchSubdomains: true }]
    }
  };

  const output = formatEnvironmentInspectionHuman(inspection);
  assert.equal(output.includes("Proxy Environment Inspection"), true);
  assert.equal(output.includes("httpProxy=http://proxy.local:8080/"), true);
  assert.equal(output.includes("*.internal.local"), true);
});

test("formats explain routes in human mode", () => {
  const result: ExplainRoutesResult = {
    agentSupport: "disabled",
    inspection: {
      cgiMode: false,
      variables: {
        http_proxy: null,
        HTTP_PROXY: null,
        https_proxy: null,
        HTTPS_PROXY: null,
        all_proxy: null,
        ALL_PROXY: null,
        no_proxy: null,
        NO_PROXY: null,
        REQUEST_METHOD: null,
        request_method: null
      },
      resolution: [],
      settings: {
        httpProxy: null,
        httpsProxy: null,
        allProxy: null,
        noProxy: []
      }
    },
    routes: [
      {
        input: "https://example.com",
        decision: "proxy",
        targetUrl: "https://example.com/",
        targetProtocol: "https:",
        proxyUrl: "http://secure-proxy.local:8443/",
        proxySource: "httpsProxy",
        matchedNoProxyRule: null,
        reason: "Route uses httpsProxy with proxy http://secure-proxy.local:8443/.",
        agent: null,
        error: null
      },
      {
        input: "not-a-url",
        decision: "error",
        targetUrl: null,
        targetProtocol: null,
        proxyUrl: null,
        proxySource: null,
        matchedNoProxyRule: null,
        reason: "Target is not a valid URL.",
        agent: null,
        error: "invalid_target_url"
      }
    ]
  };

  const output = formatExplainRoutesHuman(result);
  assert.equal(output.includes("Agent support: disabled"), true);
  assert.equal(output.includes("decision: proxy"), true);
  assert.equal(output.includes("error: invalid_target_url"), true);
});

test("formats stable JSON payload", () => {
  const output = formatJson({ ok: true, count: 2 });
  assert.equal(output, '{\n  "ok": true,\n  "count": 2\n}');
});
