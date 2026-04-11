import type {
  CliCommand,
  CliParseError,
  CliParseFailure,
  CliParseResult
} from "./types.js";

const HELP_FLAGS = new Set(["-h", "--help"]);
const JSON_FLAGS = new Set(["-j", "--json"]);

/**
 * Parses CLI arguments into a structured command.
 *
 * @param argv Arguments excluding node executable and script path.
 * @returns Parse result containing command or error.
 */
export function parseCliArgs(argv: readonly string[]): CliParseResult {
  if (argv.length === 0) {
    return ok({ name: "help" });
  }

  const globalState = parseLeadingGlobalFlags(argv);
  if (!globalState.ok) {
    return globalState;
  }

  if (globalState.help) {
    return ok({ name: "help" });
  }

  if (globalState.cursor >= argv.length) {
    return ok({ name: "help" });
  }

  const command = argv[globalState.cursor];
  if (!command) {
    return ok({ name: "help" });
  }

  const rest = argv.slice(globalState.cursor + 1);

  switch (command) {
    case "help":
      return parseHelpCommand(rest);
    case "env":
      return parseEnvCommand(rest, globalState.json);
    case "explain":
      return parseExplainCommand(rest, globalState.json);
    default:
      return fail(
        "unknown_command",
        `Unknown command: ${command}`,
        "Use 'commandrelay-cli-proxy help' to see available commands."
      );
  }
}

function parseLeadingGlobalFlags(argv: readonly string[]):
  | {
      ok: true;
      help: boolean;
      json: boolean;
      cursor: number;
    }
  | CliParseFailure {
  let cursor = 0;
  let help = false;
  let json = false;

  while (cursor < argv.length) {
    const token = argv[cursor];
    if (!token) {
      break;
    }

    if (HELP_FLAGS.has(token)) {
      help = true;
      cursor += 1;
      continue;
    }

    if (JSON_FLAGS.has(token)) {
      json = true;
      cursor += 1;
      continue;
    }

    if (token.startsWith("-")) {
      return fail(
        "unknown_option",
        `Unknown option: ${token}`,
        "Use --help to see supported options."
      );
    }

    break;
  }

  return {
    ok: true,
    help,
    json,
    cursor
  };
}

function parseHelpCommand(rest: readonly string[]): CliParseResult {
  if (rest.length > 0) {
    return fail(
      "unexpected_argument",
      `Unexpected argument for help: ${rest[0]}`,
      "Run 'commandrelay-cli-proxy help'."
    );
  }

  return ok({ name: "help" });
}

function parseEnvCommand(rest: readonly string[], inheritedJson: boolean): CliParseResult {
  let json = inheritedJson;

  for (const token of rest) {
    if (JSON_FLAGS.has(token)) {
      json = true;
      continue;
    }

    if (HELP_FLAGS.has(token)) {
      return ok({ name: "help" });
    }

    if (token.startsWith("-")) {
      return fail(
        "unknown_option",
        `Unknown option for env: ${token}`,
        "Supported: --json, --help"
      );
    }

    return fail(
      "unexpected_argument",
      `Unexpected argument for env: ${token}`,
      "The env command does not accept positional arguments."
    );
  }

  return ok({
    name: "env",
    json
  });
}

function parseExplainCommand(rest: readonly string[], inheritedJson: boolean): CliParseResult {
  let json = inheritedJson;
  let withAgent = true;
  const urls: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }

    if (token === "--") {
      urls.push(...rest.slice(index + 1));
      break;
    }

    if (JSON_FLAGS.has(token)) {
      json = true;
      continue;
    }

    if (HELP_FLAGS.has(token)) {
      return ok({ name: "help" });
    }

    if (token === "--with-agent") {
      withAgent = true;
      continue;
    }

    if (token === "--no-agent") {
      withAgent = false;
      continue;
    }

    if (token.startsWith("-")) {
      return fail(
        "unknown_option",
        `Unknown option for explain: ${token}`,
        "Supported: --json, --with-agent, --no-agent, --help"
      );
    }

    urls.push(token);
  }

  if (urls.length === 0) {
    return fail(
      "missing_url",
      "The explain command requires at least one URL.",
      "Example: commandrelay-cli-proxy explain https://example.com"
    );
  }

  return ok({
    name: "explain",
    json,
    withAgent,
    urls
  });
}

function ok(value: CliCommand): CliParseResult {
  return {
    ok: true,
    value
  };
}

function fail(
  code: CliParseError["code"],
  message: string,
  hint?: string
): CliParseFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      hint
    },
    exitCode: 2
  };
}
