import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
export interface CommonPerfArgs {
  url: string;
  token: string | null;
  timeoutMs: number;
  iterations: number;
  intervalMs: number;
  pretty: boolean;
  help: boolean;
}
export interface BridgeEnvelope {
  v?: number;
  type: string;
  requestId?: string;
  timestamp?: number;
  payload: Record<string, unknown>;
}
export interface LatencySummary {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}
export interface RequestRoundtrip {
  requestId: string;
  latencyMs: number;
  response: BridgeEnvelope;
}
/**
 * Parses common benchmark CLI args.
 *
 * @param argv Raw CLI arguments (`process.argv.slice(2)`).
 * @param defaults Optional default overrides.
 * @returns Parsed common benchmark arguments.
 */
export function parseCommonPerfArgs(
  argv: string[],
  defaults: Partial<CommonPerfArgs> = {}
): CommonPerfArgs {
  const options: CommonPerfArgs = {
    url: defaults.url ?? process.env.COMMANDRELAY_BRIDGE_WS_URL ?? "ws://127.0.0.1:8787/ws",
    token: defaults.token ?? process.env.COMMANDRELAY_AUTH_TOKEN ?? null,
    timeoutMs: defaults.timeoutMs ?? 5_000,
    iterations: defaults.iterations ?? 10,
    intervalMs: defaults.intervalMs ?? 0,
    pretty: defaults.pretty ?? true,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }

    if (arg === "--compact") {
      options.pretty = false;
      continue;
    }

    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--url") {
      options.url = requireValue("--url", argv[++i]);
      continue;
    }

    if (arg.startsWith("--token=")) {
      options.token = coerceToken(arg.slice("--token=".length));
      continue;
    }
    if (arg === "--token") {
      options.token = coerceToken(requireValue("--token", argv[++i]));
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parsePositiveInt("--timeout-ms", arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInt("--timeout-ms", requireValue("--timeout-ms", argv[++i]));
      continue;
    }

    if (arg.startsWith("--iterations=")) {
      options.iterations = parsePositiveInt("--iterations", arg.slice("--iterations=".length));
      continue;
    }
    if (arg === "--iterations") {
      options.iterations = parsePositiveInt("--iterations", requireValue("--iterations", argv[++i]));
      continue;
    }

    if (arg.startsWith("--interval-ms=")) {
      options.intervalMs = parseNonNegativeInt("--interval-ms", arg.slice("--interval-ms=".length));
      continue;
    }
    if (arg === "--interval-ms") {
      options.intervalMs = parseNonNegativeInt("--interval-ms", requireValue("--interval-ms", argv[++i]));
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

/**
 * Connects to the bridge websocket and waits for both socket open and `hello` envelope.
 *
 * @param url Bridge websocket URL.
 * @param timeoutMs Timeout budget in milliseconds.
 * @returns Connected socket and handshake timings.
 */
export async function connectAndWaitForHello(
  url: string,
  timeoutMs: number
): Promise<{
  socket: WebSocket;
  openLatencyMs: number;
  helloLatencyMs: number;
  hello: BridgeEnvelope;
}> {
  const start = performance.now();
  const socket = new WebSocket(url);

  const openLatencyMs = await withTimeout(
    new Promise<number>((resolve, reject) => {
      socket.once("open", () => resolve(performance.now() - start));
      socket.once("error", (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      socket.once("close", () => {
        reject(new Error("websocket_closed_before_open"));
      });
    }),
    timeoutMs,
    "websocket_open_timeout"
  );

  const hello = await waitForEnvelope(socket, (envelope) => envelope.type === "hello", timeoutMs);
  return {
    socket,
    openLatencyMs,
    helloLatencyMs: performance.now() - start,
    hello
  };
}

/**
 * Waits for one envelope matching a predicate.
 *
 * @param socket Connected websocket.
 * @param matcher Envelope matcher.
 * @param timeoutMs Timeout budget in milliseconds.
 * @returns The matching envelope.
 */
export async function waitForEnvelope(
  socket: WebSocket,
  matcher: (envelope: BridgeEnvelope) => boolean,
  timeoutMs: number
): Promise<BridgeEnvelope> {
  return withTimeout(
    new Promise<BridgeEnvelope>((resolve, reject) => {
      const onMessage = (raw: WebSocket.RawData) => {
        const envelope = parseRawEnvelope(raw);
        if (!envelope) return;
        if (matcher(envelope)) {
          cleanup();
          resolve(envelope);
        }
      };

      const onClose = () => {
        cleanup();
        reject(new Error("websocket_closed"));
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
      };

      socket.on("message", onMessage);
      socket.on("close", onClose);
      socket.on("error", onError);
    }),
    timeoutMs,
    "wait_for_envelope_timeout"
  );
}

/**
 * Sends one request envelope and measures roundtrip latency until response.
 *
 * @param socket Connected websocket.
 * @param requestType Request envelope type.
 * @param payload Request payload.
 * @param expectedTypes Allowed response types for the same `requestId`.
 * @param timeoutMs Timeout budget in milliseconds.
 * @returns Roundtrip details with response envelope.
 */
export async function requestRoundtrip(
  socket: WebSocket,
  requestType: string,
  payload: Record<string, unknown>,
  expectedTypes: string[],
  timeoutMs: number
): Promise<RequestRoundtrip> {
  const requestId = randomUUID();

  const responsePromise = waitForEnvelope(
    socket,
    (envelope) => {
      if (envelope.requestId !== requestId) {
        return false;
      }
      return expectedTypes.includes(envelope.type) || envelope.type === "error" || envelope.type === "auth_error";
    },
    timeoutMs
  );

  const start = performance.now();
  socket.send(
    JSON.stringify({
      v: 1,
      type: requestType,
      requestId,
      timestamp: Date.now(),
      payload
    })
  );

  const response = await responsePromise;

  return {
    requestId,
    latencyMs: performance.now() - start,
    response
  };
}

/**
 * Runs bridge auth when required by `hello` or when a token is explicitly provided.
 *
 * @param socket Connected websocket.
 * @param hello Hello envelope payload from server.
 * @param token Optional auth token.
 * @param timeoutMs Timeout budget in milliseconds.
 * @returns Auth timing details or null latency when auth was skipped.
 */
export async function authenticateIfNeeded(
  socket: WebSocket,
  hello: BridgeEnvelope,
  token: string | null,
  timeoutMs: number
): Promise<{ attempted: boolean; latencyMs: number | null; mode?: string }> {
  const requiresAuth = hello.payload.requiresAuth === true;
  if (!requiresAuth && !token) {
    return { attempted: false, latencyMs: null };
  }
  if (requiresAuth && !token) {
    throw new Error("bridge requires auth but no token was provided (--token or COMMANDRELAY_AUTH_TOKEN)");
  }

  const auth = await requestRoundtrip(
    socket,
    "auth",
    { token: token ?? "" },
    ["auth_ok", "auth_error"],
    timeoutMs
  );

  if (auth.response.type !== "auth_ok") {
    const code = String(auth.response.payload.code ?? "auth_failed");
    throw new Error(`auth failed: ${code}`);
  }

  return {
    attempted: true,
    latencyMs: auth.latencyMs,
    mode: typeof auth.response.payload.mode === "string" ? auth.response.payload.mode : undefined
  };
}

/**
 * Summarizes a non-empty latency sample set.
 *
 * @param samples Latencies in milliseconds.
 * @returns Statistical summary.
 */
export function summarizeLatenciesMs(samples: number[]): LatencySummary {
  if (samples.length === 0) throw new Error("cannot summarize empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);

  return {
    count: sorted.length,
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted[sorted.length - 1]),
    avgMs: roundMs(sum / sorted.length),
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99)
  };
}

/**
 * Sleeps for a fixed duration.
 *
 * @param ms Duration in milliseconds.
 * @returns Promise resolved after the delay.
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Closes a websocket and waits briefly for the close event.
 *
 * @param socket Connected websocket.
 * @param timeoutMs Close timeout in milliseconds.
 * @returns Promise resolved when close is observed or timeout elapses.
 */
export async function closeWebSocket(socket: WebSocket, timeoutMs = 1_000): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return;
  const closePromise = new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
  });
  socket.close();
  await withTimeout(closePromise, timeoutMs, "close_timeout").catch(() => undefined);
}

/**
 * Prints structured output as JSON.
 *
 * @param value Output object.
 * @param pretty Whether to pretty-print with indentation.
 */
export function printJson(value: unknown, pretty: boolean): void {
  const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(`${text}\n`);
}

function coerceToken(token: string): string | null {
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(flag: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInt(flag: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return value;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return roundMs(sorted[0]);
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return roundMs(sorted[lower]);
  const blended = sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
  return roundMs(blended);
}

function roundMs(value: number): number {
  return Number.parseFloat(value.toFixed(3));
}
function parseRawEnvelope(raw: WebSocket.RawData): BridgeEnvelope | null {
  const text = decodeRawData(raw);
  try {
    const parsed = JSON.parse(text) as Partial<BridgeEnvelope>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.type !== "string") return null;
    if (!parsed.payload || typeof parsed.payload !== "object" || Array.isArray(parsed.payload)) {
      return null;
    }

    return {
      v: typeof parsed.v === "number" ? parsed.v : undefined,
      type: parsed.type,
      requestId: typeof parsed.requestId === "string" ? parsed.requestId : undefined,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : undefined,
      payload: parsed.payload
    };
  } catch {
    return null;
  }
}
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function decodeRawData(raw: WebSocket.RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}
