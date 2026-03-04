import assert from "node:assert/strict";
import test from "node:test";
import {
  ProxyRuntimeController,
  createProxyRuntimeController,
  loadProxySettings
} from "../src/index.js";

test("ProxyRuntimeController resolves direct/proxy/no_proxy decisions with metadata", () => {
  const controller = createProxyRuntimeController({
    settings: loadProxySettings({
      https_proxy: "http://proxy.local:8443",
      no_proxy: "internal.local"
    })
  });

  const proxied = controller.resolve("https://api.public.local/v1");
  const proxiedFromCache = controller.resolve("https://admin.public.local/v1");
  const bypassed = controller.resolve("https://service.internal.local/v1");

  assert.equal(proxied.viaProxy, true);
  assert.equal(proxied.metadata.mode, "proxy");
  assert.equal(proxied.metadata.reason, "proxy_configured");
  assert.equal(proxied.proxyUrl, "http://proxy.local:8443/");

  assert.equal(proxiedFromCache.viaProxy, true);
  assert.equal(proxiedFromCache.fromCache, true);
  assert.equal(controller.cacheSize, 1);

  assert.equal(bypassed.viaProxy, false);
  assert.equal(bypassed.metadata.reason, "no_proxy_match");
  assert.equal(bypassed.metadata.matchedNoProxy, true);

  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.stats.resolveCount, 3);
  assert.equal(snapshot.stats.proxiedCount, 2);
  assert.equal(snapshot.stats.directCount, 1);
  assert.equal(snapshot.stats.noProxyBypassCount, 1);
  assert.equal(snapshot.stats.cacheHitCount, 1);

  controller.destroy();
});

test("ProxyRuntimeController marks direct routing when no proxy is configured", () => {
  const controller = new ProxyRuntimeController({
    settings: loadProxySettings({})
  });

  const result = controller.resolve("http://public.local/service");

  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
  assert.equal(result.metadata.mode, "direct");
  assert.equal(result.metadata.reason, "proxy_not_configured");
  assert.equal(result.metadata.matchedNoProxy, false);

  controller.destroy();
});

test("ProxyRuntimeController supports updateSettings and reloadFromEnvironment", () => {
  const env: Record<string, string> = {
    http_proxy: "http://proxy-one.local:8080"
  };

  const controller = new ProxyRuntimeController({ env });
  const first = controller.resolve("http://service.example/v1");
  const firstCached = controller.resolve("http://api.example/v1");

  assert.equal(first.proxyUrl, "http://proxy-one.local:8080/");
  assert.equal(firstCached.fromCache, true);
  assert.equal(controller.cacheSize, 1);

  controller.updateSettings(
    loadProxySettings({
      http_proxy: "http://proxy-two.local:8080"
    })
  );

  assert.equal(controller.cacheSize, 0);

  const updated = controller.resolve("http://service.example/v1");
  assert.equal(updated.proxyUrl, "http://proxy-two.local:8080/");
  assert.equal(updated.fromCache, false);

  env.http_proxy = "http://proxy-three.local:8080";
  env.no_proxy = "service.example";
  const reloaded = controller.reloadFromEnvironment();
  assert.equal(reloaded.httpProxy, "http://proxy-three.local:8080/");

  const bypassed = controller.resolve("http://service.example/v1");
  assert.equal(bypassed.viaProxy, false);
  assert.equal(bypassed.metadata.reason, "no_proxy_match");
});

test("ProxyRuntimeController lifecycle operations clear cache and update disposed status", () => {
  const controller = createProxyRuntimeController({
    settings: loadProxySettings({
      http_proxy: "http://proxy.local:8080"
    })
  });

  controller.resolve("http://service.example/v1");
  assert.equal(controller.cacheSize, 1);

  controller.clear();
  assert.equal(controller.cacheSize, 0);
  assert.equal(controller.getSnapshot().disposed, false);

  controller.resolve("http://service.example/v1");
  controller.destroy();

  const destroyedSnapshot = controller.getSnapshot();
  assert.equal(destroyedSnapshot.disposed, true);
  assert.equal(destroyedSnapshot.cacheSize, 0);

  controller.resolve("http://service.example/v1");
  assert.equal(controller.getSnapshot().disposed, false);

  controller.dispose();
  assert.equal(controller.getSnapshot().disposed, true);
});

test("getSnapshot returns defensive copies", () => {
  const controller = createProxyRuntimeController({
    settings: loadProxySettings({
      http_proxy: "http://proxy.local:8080"
    })
  });

  controller.resolve("http://service.example/v1");

  const firstSnapshot = controller.getSnapshot();
  firstSnapshot.settings.noProxy.push({
    host: "local-only",
    port: null,
    wildcardSubdomains: false
  });
  firstSnapshot.stats.resolveCount = 0;

  const secondSnapshot = controller.getSnapshot();
  assert.equal(secondSnapshot.settings.noProxy.length, 0);
  assert.equal(secondSnapshot.stats.resolveCount, 1);

  controller.destroy();
});
