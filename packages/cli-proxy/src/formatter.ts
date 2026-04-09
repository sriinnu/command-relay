import type {
  CliParseError,
  ExplainRoutesResult,
  ProxyEnvironmentInspection
} from "./types.js";

/**
 * Formats CLI help text.
 *
 * @returns Human-readable usage guide.
 */
export function formatHelpText(): string {
  return [
    "@commandrelay/cli-proxy",
    "",
    "Usage:",
    "  commandrelay-cli-proxy env [--json]",
    "  commandrelay-cli-proxy explain [--json] [--with-agent|--no-agent] <url...>",
    "  commandrelay-cli-proxy help",
    "",
    "Commands:",
    "  env      Inspect proxy-related environment variables and normalized settings.",
    "  explain  Explain route decisions for one or more URLs.",
    "  help     Show command help.",
    "",
    "Options:",
    "  -j, --json      Output machine-readable JSON.",
    "  -h, --help      Show help.",
    "  --with-agent    Include optional @commandrelay/proxy-agent explain details.",
    "  --no-agent      Skip optional proxy-agent explain details."
  ].join("\n");
}

/**
 * Formats a parse error for human output.
 *
 * @param error Parse error payload.
 * @returns Human-readable error text.
 */
export function formatParseError(error: CliParseError): string {
  const lines = [`Error: ${error.message}`];
  if (error.hint) {
    lines.push(`Hint: ${error.hint}`);
  }
  return lines.join("\n");
}

/**
 * Formats environment inspection for terminal output.
 *
 * @param inspection Environment inspection model.
 * @returns Human-readable inspection text.
 */
export function formatEnvironmentInspectionHuman(
  inspection: ProxyEnvironmentInspection
): string {
  const lines: string[] = [];
  lines.push("Proxy Environment Inspection");
  lines.push("");
  lines.push(`CGI mode: ${inspection.cgiMode ? "yes" : "no"}`);
  lines.push("Environment variables:");

  for (const [key, value] of Object.entries(inspection.variables)) {
    lines.push(`  ${key}=${formatNullable(value)}`);
  }

  lines.push("");
  lines.push("Resolution:");
  for (const item of inspection.resolution) {
    const selected = item.selectedKey
      ? `${item.selectedKey}=${formatNullable(item.selectedValue)}`
      : "<unset>";
    const ignored = item.ignoredUppercase ? " (uppercase ignored)" : "";
    lines.push(`  ${item.logicalName}: ${selected}${ignored}`);
  }

  lines.push("");
  lines.push("Effective settings:");
  lines.push(`  httpProxy=${formatNullable(inspection.settings.httpProxy)}`);
  lines.push(`  httpsProxy=${formatNullable(inspection.settings.httpsProxy)}`);
  lines.push(`  allProxy=${formatNullable(inspection.settings.allProxy)}`);

  if (inspection.settings.noProxy.length === 0) {
    lines.push("  noProxyRules=<none>");
  } else {
    lines.push("  noProxyRules:");
    for (const rule of inspection.settings.noProxy) {
      lines.push(`    - ${formatNoProxyRule(rule.host, rule.port, rule.matchSubdomains)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats route explain output for terminal usage.
 *
 * @param result Route explanation result.
 * @returns Human-readable route report.
 */
export function formatExplainRoutesHuman(result: ExplainRoutesResult): string {
  const lines: string[] = [];
  lines.push("Proxy Route Explain");
  lines.push(`Agent support: ${result.agentSupport}`);

  for (let index = 0; index < result.routes.length; index += 1) {
    const route = result.routes[index];
    lines.push("");
    lines.push(`[${index + 1}] ${route.input}`);
    lines.push(`  decision: ${route.decision}`);

    if (route.error) {
      lines.push(`  error: ${route.error}`);
      lines.push(`  reason: ${route.reason}`);
      continue;
    }

    lines.push(`  target: ${formatNullable(route.targetUrl)}`);
    lines.push(`  protocol: ${formatNullable(route.targetProtocol)}`);
    lines.push(`  proxyUrl: ${formatNullable(route.proxyUrl)}`);
    lines.push(`  proxySource: ${formatNullable(route.proxySource)}`);

    if (route.matchedNoProxyRule) {
      lines.push(
        `  matchedNoProxyRule: ${formatNoProxyRule(
          route.matchedNoProxyRule.host,
          route.matchedNoProxyRule.port,
          route.matchedNoProxyRule.matchSubdomains
        )}`
      );
    } else {
      lines.push("  matchedNoProxyRule: <none>");
    }

    lines.push(`  reason: ${route.reason}`);

    if (route.agent) {
      lines.push(`  agent.adapter: ${route.agent.adapter}`);
      lines.push(`  agent.class: ${formatNullable(route.agent.agentClass)}`);
      lines.push(`  agent.viaProxy: ${route.agent.viaProxy ? "true" : "false"}`);
      lines.push(`  agent.proxyUrl: ${formatNullable(route.agent.proxyUrl)}`);
      lines.push(`  agent.error: ${formatNullable(route.agent.error)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats JSON payload for CLI output.
 *
 * @param payload Serializable payload.
 * @returns Pretty JSON string.
 */
export function formatJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function formatNoProxyRule(host: string, port: number | null, wildcard: boolean): string {
  const ruleHost = wildcard && host !== "*" ? `*.${host}` : host;
  return port === null ? ruleHost : `${ruleHost}:${port}`;
}

function formatNullable(value: string | number | null): string {
  return value === null ? "<unset>" : String(value);
}
