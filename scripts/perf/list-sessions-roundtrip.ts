import {
  authenticateIfNeeded,
  closeWebSocket,
  connectAndWaitForHello,
  parseCommonPerfArgs,
  printJson,
  requestRoundtrip,
  sleep,
  summarizeLatenciesMs
} from "./bridge-perf-common.js";

const USAGE = `Usage:
  node --import tsx scripts/perf/list-sessions-roundtrip.ts [options]

Measures request/response latency for list_sessions -> session_list roundtrips.

Options:
  --url <ws-url>         Bridge websocket URL (default: ws://127.0.0.1:8787/ws)
  --token <token>        Auth token (or use COMMANDRELAY_AUTH_TOKEN)
  --iterations <n>       Number of roundtrip samples (default: 10)
  --timeout-ms <ms>      Timeout per request (default: 5000)
  --interval-ms <ms>     Delay between requests (default: 0)
  --pretty               Pretty JSON output (default)
  --compact              Compact JSON output
  --help, -h             Show this help

Examples:
  node --import tsx scripts/perf/list-sessions-roundtrip.ts
  node --import tsx scripts/perf/list-sessions-roundtrip.ts --iterations 50 --token "$COMMANDRELAY_AUTH_TOKEN"
`;

interface ListSessionsSample {
  iteration: number;
  latencyMs: number;
  paneCount: number;
  sessionCount: number;
}

async function main(): Promise<void> {
  const options = parseCommonPerfArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { socket, hello, openLatencyMs, helloLatencyMs } = await connectAndWaitForHello(
    options.url,
    options.timeoutMs
  );

  try {
    const auth = await authenticateIfNeeded(socket, hello, options.token, options.timeoutMs);
    const samples: ListSessionsSample[] = [];

    for (let i = 0; i < options.iterations; i += 1) {
      const roundtrip = await requestRoundtrip(
        socket,
        "list_sessions",
        {},
        ["session_list"],
        options.timeoutMs
      );

      if (roundtrip.response.type !== "session_list") {
        const code = String(roundtrip.response.payload.code ?? "unexpected_response");
        throw new Error(`list_sessions failed: ${code}`);
      }

      const panes = Array.isArray(roundtrip.response.payload.panes)
        ? roundtrip.response.payload.panes
        : [];
      const sessions = Array.isArray(roundtrip.response.payload.sessions)
        ? roundtrip.response.payload.sessions
        : [];

      samples.push({
        iteration: i + 1,
        latencyMs: roundtrip.latencyMs,
        paneCount: panes.length,
        sessionCount: sessions.length
      });

      if (options.intervalMs > 0 && i < options.iterations - 1) {
        await sleep(options.intervalMs);
      }
    }

    const output = {
      benchmark: "list_sessions_roundtrip",
      timestamp: new Date().toISOString(),
      target: {
        url: options.url,
        requiresAuth: hello.payload.requiresAuth === true
      },
      options: {
        iterations: options.iterations,
        timeoutMs: options.timeoutMs,
        intervalMs: options.intervalMs
      },
      handshake: {
        openLatencyMs,
        helloLatencyMs,
        authAttempted: auth.attempted,
        authLatencyMs: auth.latencyMs,
        authMode: auth.mode ?? null
      },
      summary: {
        roundtripLatencyMs: summarizeLatenciesMs(samples.map((sample) => sample.latencyMs)),
        paneCount: summarizeLatenciesMs(samples.map((sample) => sample.paneCount)),
        sessionCount: summarizeLatenciesMs(samples.map((sample) => sample.sessionCount))
      },
      samples
    };

    printJson(output, options.pretty);
  } finally {
    await closeWebSocket(socket);
  }
}

main().catch((error) => {
  process.stderr.write(
    `list-sessions-roundtrip error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
