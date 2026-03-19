#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_PHASE_SCRIPT="${SCRIPT_DIR}/run-phase.sh"
NODE_CMD=(npm exec -- node)

PACKAGE_DIRS=(
  "packages/proxy-core"
  "packages/proxy-agent"
  "packages/proxy-http-client"
  "packages/proxy-axios"
  "packages/proxy-got"
  "packages/proxy-runtime"
)

log() {
  printf '==> %s\n' "$*"
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

read_pack_field() {
  local field_name="$1"
  local input
  local field_value

  input="$(cat)"
  field_value="$(printf '%s' "${input}" | tr -d '\r\n' | sed -n "s/.*\"${field_name}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p")"

  if [[ -z "${field_value}" ]]; then
    echo "npm pack did not return field '${field_name}': ${input}" >&2
    return 1
  fi

  printf '%s' "${field_value}"
}

extract_packed_package() {
  local package_name="$1"
  local tarball_path="$2"
  local package_scope="${package_name%%/*}"
  local package_basename="${package_name##*/}"
  local destination_dir

  if [[ "${package_name}" == @*/* ]]; then
    destination_dir="${CONSUMER_DIR}/node_modules/${package_scope}/${package_basename}"
  else
    destination_dir="${CONSUMER_DIR}/node_modules/${package_name}"
  fi

  mkdir -p "${destination_dir}"
  tar -xzf "${tarball_path}" -C "${destination_dir}" --strip-components=1
}

write_consumer_smoke_files() {
  cat > "${CONSUMER_DIR}/package.json" <<'JSON'
{
  "name": "consumer-smoke-temp",
  "private": true,
  "type": "module"
}
JSON

  cat > "${CONSUMER_DIR}/consumer-smoke.mjs" <<'JS'
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  loadProxySettings as loadCoreProxySettings,
  resolveProxyForUrl as resolveCoreProxyForUrl
} from "@commandrelay/proxy-core";
import {
  ProxyAgentFactory,
  loadProxySettings as loadAgentProxySettings,
  resolveProxyForUrl as resolveAgentProxyForUrl
} from "@commandrelay/proxy-agent";
import { requestJson } from "@commandrelay/proxy-http-client";
import {
  ProxyAxiosAgentResolver,
  applyProxyAgentToAxiosConfig,
  resolveAxiosRequestTarget
} from "@termina/proxy-axios";
import {
  ProxyGotAgentResolver,
  applyProxyGotAgent,
  createProxyGotAgentResolver,
  resolveGotRequestTarget
} from "@termina/proxy-got";
import {
  createProxyRuntimeController,
  loadProxySettings as loadRuntimeProxySettings
} from "@termina/proxy-runtime";

const coreSettings = loadCoreProxySettings({
  http_proxy: "http://proxy.local:8080",
  https_proxy: "http://secure-proxy.local",
  no_proxy: "internal.local"
});
assert.equal(
  resolveCoreProxyForUrl("https://public.local", coreSettings),
  "http://secure-proxy.local/"
);
assert.equal(resolveCoreProxyForUrl("https://api.internal.local", coreSettings), null);

const agentSettings = loadAgentProxySettings({
  http_proxy: "http://proxy.local:8080",
  no_proxy: "internal.local"
});
const proxiedFactory = new ProxyAgentFactory({ settings: agentSettings, maxCacheEntries: 16 });
const firstProxyResolution = proxiedFactory.resolve("http://public.local");
assert.equal(firstProxyResolution.viaProxy, true);
assert.equal(firstProxyResolution.proxyUrl, "http://proxy.local:8080/");
assert.ok(firstProxyResolution.agent);

const cachedProxyResolution = proxiedFactory.resolve("http://another.public.local");
assert.equal(cachedProxyResolution.fromCache, true);
assert.equal(cachedProxyResolution.agent, firstProxyResolution.agent);
assert.equal(resolveAgentProxyForUrl("http://api.internal.local", agentSettings), null);
assert.equal(proxiedFactory.resolve("http://api.internal.local").viaProxy, false);

const axiosResolver = new ProxyAxiosAgentResolver({
  env: {
    https_proxy: "http://axios-proxy.local:8443",
    no_proxy: "internal.local"
  }
});
const axiosTarget = resolveAxiosRequestTarget({
  baseURL: "https://api.public.local/v1/",
  url: "health"
});
assert.equal(axiosTarget.href, "https://api.public.local/v1/health");
const axiosApplied = applyProxyAgentToAxiosConfig(
  {
    baseURL: "https://api.public.local",
    url: "/orders",
    method: "GET",
    proxy: {
      host: "legacy-proxy.local"
    }
  },
  axiosResolver
);
assert.equal(axiosApplied.target.href, "https://api.public.local/orders");
assert.equal(axiosApplied.routing.viaProxy, true);
assert.equal(axiosApplied.routing.proxyUrl, "http://axios-proxy.local:8443/");
assert.equal(axiosApplied.routing.fromCache, false);
assert.equal(axiosApplied.config.proxy, false);
assert.equal(axiosApplied.config.httpsAgent?.constructor.name, "HttpsProxyAgent");
const axiosBypassed = axiosResolver.resolve("https://api.internal.local/health");
assert.equal(axiosBypassed.viaProxy, false);
assert.equal(axiosBypassed.proxyUrl, null);
axiosResolver.destroy();

const gotResolver = new ProxyGotAgentResolver({
  env: {
    https_proxy: "http://got-proxy.local:8443",
    no_proxy: "internal.local"
  }
});
const existingHttp2Agent = { tag: "existing-http2" };
const gotApplied = applyProxyGotAgent(
  {
    url: "health",
    prefixUrl: "https://api.external.local/v1",
    agent: {
      http2: existingHttp2Agent
    }
  },
  gotResolver
);
assert.equal(gotApplied.targetUrl.toString(), "https://api.external.local/v1/health");
assert.equal(gotApplied.protocol, "https");
assert.equal(gotApplied.viaProxy, true);
assert.equal(gotApplied.proxyUrl, "http://got-proxy.local:8443/");
assert.equal(gotApplied.fromCache, false);
assert.equal(gotApplied.options.agent?.https?.constructor.name, "HttpsProxyAgent");
assert.equal(gotApplied.options.agent?.http2, existingHttp2Agent);
const gotBypassedTarget = resolveGotRequestTarget(undefined, {
  url: "https://api.internal.local/health"
});
const gotBypassed = gotResolver.resolve(gotBypassedTarget);
assert.equal(gotBypassed.viaProxy, false);
const gotResolverFromFactory = createProxyGotAgentResolver({ env: {} });
const gotDirect = gotResolverFromFactory.resolve("https://api.external.local/health");
assert.equal(gotDirect.viaProxy, false);
gotResolverFromFactory.destroy();
gotResolver.destroy();

const runtimeController = createProxyRuntimeController({
  settings: loadRuntimeProxySettings({
    https_proxy: "http://runtime-proxy.local:8443",
    no_proxy: "internal.local"
  })
});
const runtimeFirst = runtimeController.resolve("https://api.public.local/v1");
const runtimeSecond = runtimeController.resolve("https://admin.public.local/v1");
const runtimeBypassed = runtimeController.resolve("https://service.internal.local/v1");
assert.equal(runtimeFirst.viaProxy, true);
assert.equal(runtimeFirst.metadata.mode, "proxy");
assert.equal(runtimeFirst.metadata.reason, "proxy_configured");
assert.equal(runtimeFirst.proxyUrl, "http://runtime-proxy.local:8443/");
assert.equal(runtimeSecond.fromCache, true);
assert.equal(runtimeBypassed.viaProxy, false);
assert.equal(runtimeBypassed.metadata.reason, "no_proxy_match");
const runtimeSnapshot = runtimeController.getSnapshot();
assert.equal(runtimeSnapshot.stats.resolveCount, 3);
assert.equal(runtimeSnapshot.stats.proxiedCount, 2);
assert.equal(runtimeSnapshot.stats.directCount, 1);
assert.equal(runtimeSnapshot.stats.noProxyBypassCount, 1);
assert.equal(runtimeSnapshot.stats.cacheHitCount, 1);
runtimeController.destroy();

const directFactory = new ProxyAgentFactory({
  settings: {
    httpProxy: null,
    httpsProxy: null,
    allProxy: null,
    noProxy: []
  }
});

class FakeClientRequest extends EventEmitter {
  constructor(onEnd) {
    super();
    this.onEnd = onEnd;
    this.bodyChunks = [];
  }

  write(chunk) {
    this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  }

  end(chunk) {
    if (chunk !== undefined) {
      this.write(chunk);
    }
    this.onEnd(this);
  }

  destroy(error) {
    if (error) {
      this.emit("error", error);
    }
    return this;
  }

  bodyText() {
    return Buffer.concat(this.bodyChunks).toString("utf8");
  }
}

let capturedRequest = null;
const createRequest = (_options, callback) => {
  const request = new FakeClientRequest((finalizedRequest) => {
    capturedRequest = finalizedRequest;
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = { "content-type": "application/json" };
    callback(response);
    response.emit("data", Buffer.from(JSON.stringify({ ok: true })));
    response.emit("end");
  });
  return request;
};

const transport = {
  httpRequest: createRequest,
  httpsRequest: createRequest
};

const response = await requestJson("http://consumer-smoke.local/health", {
  method: "POST",
  body: { ping: true },
  proxyResolver: directFactory,
  timeoutMs: 3_000,
  transport
});
assert.equal(response.status, 200);
assert.deepEqual(response.body, { ok: true });
assert.ok(capturedRequest);
assert.equal(capturedRequest.bodyText(), '{"ping":true}');

console.log("consumer smoke verification passed");
JS
}

require_command "npm"
require_command "tar"

TMP_ROOT="$(mktemp -d "${REPO_ROOT}/.consumer-smoke.XXXXXX")"
PACK_DIR="${TMP_ROOT}/packs"
CONSUMER_DIR="${TMP_ROOT}/consumer"
mkdir -p "${PACK_DIR}" "${CONSUMER_DIR}"

cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

export NPM_CONFIG_CACHE="${TMP_ROOT}/.npm-cache"
export npm_config_audit="false"
export npm_config_fund="false"
export npm_config_update_notifier="false"

log "Building package artifacts"
"${RUN_PHASE_SCRIPT}" build

for package_dir in "${PACKAGE_DIRS[@]}"; do
  package_json="${REPO_ROOT}/${package_dir}/package.json"
  if [[ ! -f "${package_json}" ]]; then
    echo "Missing package.json: ${package_json}" >&2
    exit 1
  fi

  log "Packing ${package_dir}"
  pack_output="$(
    cd "${REPO_ROOT}/${package_dir}"
    npm pack --json --silent
  )"
  package_name="$(printf '%s' "${pack_output}" | read_pack_field name)"
  filename="$(printf '%s' "${pack_output}" | read_pack_field filename)"
  tarball_path="${REPO_ROOT}/${package_dir}/${filename}"

  if [[ ! -f "${tarball_path}" ]]; then
    echo "Packed artifact missing: ${tarball_path}" >&2
    exit 1
  fi

  mv "${tarball_path}" "${PACK_DIR}/${filename}"
  tarball_path="${PACK_DIR}/${filename}"

  extract_packed_package "${package_name}" "${tarball_path}"
done

mkdir -p "${CONSUMER_DIR}/node_modules"

write_consumer_smoke_files

log "Running temporary consumer smoke checks"
(
  cd "${CONSUMER_DIR}"
  "${NODE_CMD[@]}" consumer-smoke.mjs
)

log "Consumer smoke verification completed"
