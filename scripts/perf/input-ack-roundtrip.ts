import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);
const TMUX_TIMEOUT_MS = 5_000;
const INPUT_SAMPLE_PAYLOAD = "x";

const USAGE = `Usage:
  node --import tsx scripts/perf/input-ack-roundtrip.ts [options]

Measures input -> ack roundtrip latency using an isolated temporary tmux pane.
This script is non-destructive by default: it creates a detached tmux session running 'cat >/dev/null',
benchmarks against that pane, then deletes the session.

Options:
  --url <ws-url>         Bridge websocket URL (default: ws://127.0.0.1:8787/ws)
  --token <token>        Auth token (or use COMMANDRELAY_AUTH_TOKEN)
  --iterations <n>       Number of input/ack samples (default: 10)
  --timeout-ms <ms>      Timeout per protocol step (default: 5000)
  --interval-ms <ms>     Delay between input requests (default: 0)
  --pretty               Pretty JSON output (default)
  --compact              Compact JSON output
  --help, -h             Show this help

Examples:
  node --import tsx scripts/perf/input-ack-roundtrip.ts
  node --import tsx scripts/perf/input-ack-roundtrip.ts --iterations 30 --interval-ms 50
`;

interface InputAckSample {
  iteration: number;
  latencyMs: number;
  bytes: number;
}

interface TempPane {
  sessionName: string;
  paneId: string;
}

async function main(): Promise<void> {
  const options = parseCommonPerfArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  let tempPane: TempPane | null = null;

  const { socket, hello, openLatencyMs, helloLatencyMs } = await connectAndWaitForHello(
    options.url,
    options.timeoutMs
  );

  try {
    const auth = await authenticateIfNeeded(socket, hello, options.token, options.timeoutMs);

    tempPane = await createTemporaryPane();

    const attach = await requestRoundtrip(
      socket,
      "attach",
      { paneId: tempPane.paneId },
      ["ack"],
      options.timeoutMs
    );

    if (attach.response.type !== "ack" || attach.response.payload.action !== "attach") {
      throw new Error(`attach failed: ${String(attach.response.payload.code ?? "unexpected_response")}`);
    }

    const policy = await requestRoundtrip(
      socket,
      "enable_input",
      {},
      ["policy_update"],
      options.timeoutMs
    );

    if (policy.response.type !== "policy_update") {
      throw new Error("enable_input failed: missing policy_update");
    }
    if (policy.response.payload.inputEnabled !== true) {
      throw new Error("input remains disabled after enable_input (global kill switch may be enabled)");
    }

    const samples: InputAckSample[] = [];

    for (let i = 0; i < options.iterations; i += 1) {
      const payload = `${INPUT_SAMPLE_PAYLOAD}${i % 10}`;
      const roundtrip = await requestRoundtrip(
        socket,
        "input",
        { paneId: tempPane.paneId, data: payload },
        ["ack"],
        options.timeoutMs
      );

      if (roundtrip.response.type !== "ack" || roundtrip.response.payload.action !== "input") {
        const code = String(roundtrip.response.payload.code ?? "unexpected_response");
        throw new Error(`input failed: ${code}`);
      }

      samples.push({
        iteration: i + 1,
        latencyMs: roundtrip.latencyMs,
        bytes: Buffer.byteLength(payload, "utf8")
      });

      if (options.intervalMs > 0 && i < options.iterations - 1) {
        await sleep(options.intervalMs);
      }
    }

    const output = {
      benchmark: "input_ack_roundtrip",
      timestamp: new Date().toISOString(),
      target: {
        url: options.url,
        requiresAuth: hello.payload.requiresAuth === true
      },
      options: {
        iterations: options.iterations,
        timeoutMs: options.timeoutMs,
        intervalMs: options.intervalMs,
        samplePayloadTemplate: `${INPUT_SAMPLE_PAYLOAD}<digit>`
      },
      handshake: {
        openLatencyMs,
        helloLatencyMs,
        authAttempted: auth.attempted,
        authLatencyMs: auth.latencyMs,
        authMode: auth.mode ?? null,
        attachLatencyMs: attach.latencyMs,
        enableInputLatencyMs: policy.latencyMs
      },
      isolation: {
        mode: "temporary_tmux_session",
        sessionName: tempPane.sessionName,
        paneId: tempPane.paneId,
        command: "cat >/dev/null"
      },
      summary: {
        inputAckLatencyMs: summarizeLatenciesMs(samples.map((sample) => sample.latencyMs))
      },
      samples
    };

    printJson(output, options.pretty);
  } finally {
    await closeWebSocket(socket);
    if (tempPane) {
      await removeTemporaryPane(tempPane.sessionName);
    }
  }
}

async function createTemporaryPane(): Promise<TempPane> {
  const sessionName = `bridge_perf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const stdout = await runTmux([
    "new-session",
    "-d",
    "-P",
    "-F",
    "#{session_name}\t#{pane_id}",
    "-s",
    sessionName,
    "cat >/dev/null"
  ]);

  const [createdSessionName, paneId] = stdout.split("\t").map((value) => value.trim());

  if (!createdSessionName || !paneId) {
    throw new Error(`failed to parse tmux pane creation output: ${stdout}`);
  }

  return {
    sessionName: createdSessionName,
    paneId
  };
}

async function removeTemporaryPane(sessionName: string): Promise<void> {
  try {
    await runTmux(["kill-session", "-t", sessionName]);
  } catch {
    // Ignore cleanup races if session already exited.
  }
}

async function runTmux(args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("tmux", args, {
      timeout: TMUX_TIMEOUT_MS,
      maxBuffer: 128 * 1024,
      windowsHide: true
    });

    return result.stdout.trim();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `tmux command failed: ${JSON.stringify(error)}`;
    throw new Error(`tmux ${args.join(" ")} failed: ${message}`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `input-ack-roundtrip error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
