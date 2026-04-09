import { parseCliArgs } from "./arg-parser.js";
import { inspectProxyEnvironment } from "./env-inspector.js";
import {
  formatEnvironmentInspectionHuman,
  formatExplainRoutesHuman,
  formatHelpText,
  formatJson,
  formatParseError
} from "./formatter.js";
import { explainProxyRoutes } from "./route-explainer.js";
import type { RunCliOptions } from "./types.js";

/**
 * Runs the CLI command dispatcher.
 *
 * @param argv CLI args excluding binary/script path.
 * @param options Runtime options for environment, IO, and agent resolver overrides.
 * @returns Process exit code.
 */
export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const env = options.env ?? process.env;
  const io = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr
  };

  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    writeLine(io.stderr, formatParseError(parsed.error));
    return parsed.exitCode;
  }

  const command = parsed.value;
  switch (command.name) {
    case "help":
      writeLine(io.stdout, formatHelpText());
      return 0;
    case "env": {
      const inspection = inspectProxyEnvironment(env);
      if (command.json) {
        writeLine(io.stdout, formatJson({ command: "env", inspection }));
      } else {
        writeLine(io.stdout, formatEnvironmentInspectionHuman(inspection));
      }
      return 0;
    }
    case "explain": {
      const result = await explainProxyRoutes(command.urls, {
        env,
        enableAgent: command.withAgent,
        agentResolver: options.agentResolver
      });

      if (command.json) {
        writeLine(io.stdout, formatJson({ command: "explain", ...result }));
      } else {
        writeLine(io.stdout, formatExplainRoutesHuman(result));
      }

      return 0;
    }
    default:
      writeLine(io.stderr, "Error: unreachable command state");
      return 1;
  }
}

function writeLine(stream: { write: (chunk: string) => void }, text: string): void {
  stream.write(`${text}\n`);
}
