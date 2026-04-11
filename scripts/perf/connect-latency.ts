import {
  closeWebSocket,
  connectAndWaitForHello,
  parseCommonPerfArgs,
  printJson,
  sleep,
  summarizeLatenciesMs
} from "./bridge-perf-common.js";

const USAGE = `Usage:
  node --import tsx scripts/perf/connect-latency.ts [options]

Measures websocket connect latency (socket open + hello reception) for the local bridge.

Options:
  --url <ws-url>         Bridge websocket URL (default: ws://127.0.0.1:8787/ws)
  --iterations <n>       Number of samples to collect (default: 10)
  --timeout-ms <ms>      Timeout per connect attempt (default: 5000)
  --interval-ms <ms>     Delay between attempts (default: 0)
  --pretty               Pretty JSON output (default)
  --compact              Compact JSON output
  --help, -h             Show this help

Examples:
  node --import tsx scripts/perf/connect-latency.ts
  node --import tsx scripts/perf/connect-latency.ts --iterations 25 --interval-ms 100
`;

interface ConnectSample {
  iteration: number;
  openLatencyMs: number;
  helloLatencyMs: number;
  serverRequiresAuth: boolean;
}

async function main(): Promise<void> {
  const options = parseCommonPerfArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const samples: ConnectSample[] = [];

  for (let i = 0; i < options.iterations; i += 1) {
    const { socket, openLatencyMs, helloLatencyMs, hello } = await connectAndWaitForHello(
      options.url,
      options.timeoutMs
    );

    samples.push({
      iteration: i + 1,
      openLatencyMs,
      helloLatencyMs,
      serverRequiresAuth: hello.payload.requiresAuth === true
    });

    await closeWebSocket(socket);
    if (options.intervalMs > 0 && i < options.iterations - 1) {
      await sleep(options.intervalMs);
    }
  }

  const output = {
    benchmark: "connect_latency",
    timestamp: new Date().toISOString(),
    target: {
      url: options.url
    },
    options: {
      iterations: options.iterations,
      timeoutMs: options.timeoutMs,
      intervalMs: options.intervalMs
    },
    summary: {
      openLatencyMs: summarizeLatenciesMs(samples.map((sample) => sample.openLatencyMs)),
      helloLatencyMs: summarizeLatenciesMs(samples.map((sample) => sample.helloLatencyMs))
    },
    samples
  };

  printJson(output, options.pretty);
}

main().catch((error) => {
  process.stderr.write(`connect-latency error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
