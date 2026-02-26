export {
  ProxyUndiciDispatcherFactory,
  createProxyUndiciDispatcherFactory,
  type ProxyUndiciDispatcherFactoryOptions,
  type ProxyUndiciDispatcherResolution,
  type UndiciDirectDispatcherOptions,
  type UndiciDispatcherAdapter,
  type UndiciProxyDispatcherOptions
} from "./proxy-undici-dispatcher-factory.js";
export {
  DEFAULT_CACHE_ENTRIES,
  BoundedDispatcherCache,
  normalizeCacheEntries
} from "./bounded-dispatcher-cache.js";
export {
  InvalidProxyUrlError,
  InvalidTargetUrlError,
  UnsupportedProxyProtocolError,
  UnsupportedTargetProtocolError
} from "./errors.js";
export {
  loadProxySettings,
  parseNoProxy,
  resolveProxyForUrl,
  shouldBypassProxy,
  type NoProxyRule,
  type ProxyEnvironment,
  type ProxySettings
} from "@commandrelay/proxy-core";
