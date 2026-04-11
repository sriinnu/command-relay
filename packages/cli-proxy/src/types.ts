import type {
  NoProxyRule,
  ProxyEnvironment,
  ProxySettings
} from "@commandrelay/proxy-core";

/** Proxy setting bucket selected for a route. */
export type ProxySettingSource = "httpProxy" | "httpsProxy" | "allProxy";

/** Route decision computed by the explainer. */
export type RouteDecision = "proxy" | "direct" | "error";

/** Agent support mode for a route explain run. */
export type AgentSupport = "enabled" | "unavailable" | "disabled";

/** Environment keys included in snapshot output. */
export type ProxySnapshotKey =
  | "http_proxy"
  | "HTTP_PROXY"
  | "https_proxy"
  | "HTTPS_PROXY"
  | "all_proxy"
  | "ALL_PROXY"
  | "no_proxy"
  | "NO_PROXY"
  | "REQUEST_METHOD"
  | "request_method";

/** Snapshot of relevant proxy environment variables. */
export type ProxyEnvironmentSnapshot = Readonly<Record<ProxySnapshotKey, string | null>>;

/** How each logical proxy variable resolved from uppercase/lowercase inputs. */
export interface ProxyVariableResolution {
  logicalName: "httpProxy" | "httpsProxy" | "allProxy" | "noProxy";
  selectedKey: string | null;
  selectedValue: string | null;
  lowerKey: string;
  lowerValue: string | null;
  upperKey: string;
  upperValue: string | null;
  ignoredUppercase: boolean;
}

/** Structured output of proxy environment inspection. */
export interface ProxyEnvironmentInspection {
  cgiMode: boolean;
  variables: ProxyEnvironmentSnapshot;
  resolution: ProxyVariableResolution[];
  settings: ProxySettings;
}

/** Optional proxy-agent enrichment for a route. */
export interface ProxyAgentResolutionDetail {
  adapter: string;
  agentClass: string | null;
  viaProxy: boolean;
  proxyUrl: string | null;
  error: string | null;
}

/** One route explanation entry. */
export interface RouteExplanation {
  input: string;
  decision: RouteDecision;
  targetUrl: string | null;
  targetProtocol: string | null;
  proxyUrl: string | null;
  proxySource: ProxySettingSource | null;
  matchedNoProxyRule: NoProxyRule | null;
  reason: string;
  agent: ProxyAgentResolutionDetail | null;
  error: string | null;
}

/** Result envelope for explain operations. */
export interface ExplainRoutesResult {
  inspection: ProxyEnvironmentInspection;
  routes: RouteExplanation[];
  agentSupport: AgentSupport;
}

/** Minimal adapter contract for optional proxy-agent integration. */
export interface ProxyAgentRouteResolver {
  /**
   * Resolves proxy-agent metadata for a target route.
   *
   * @param target Target URL input.
   * @param env Environment map used to initialize resolver behavior.
   */
  resolve(
    target: string | URL,
    env: ProxyEnvironment
  ): Promise<ProxyAgentResolutionDetail>;
}

/** Options for route explanation. */
export interface ExplainRoutesOptions {
  env?: ProxyEnvironment;
  enableAgent?: boolean;
  agentResolver?: ProxyAgentRouteResolver | null;
}

/** CLI command model. */
export type CliCommand = HelpCommand | EnvCommand | ExplainCommand;

/** Help command. */
export interface HelpCommand {
  name: "help";
}

/** Env inspection command. */
export interface EnvCommand {
  name: "env";
  json: boolean;
}

/** Route explain command. */
export interface ExplainCommand {
  name: "explain";
  json: boolean;
  withAgent: boolean;
  urls: string[];
}

/** Parse error model for CLI args. */
export interface CliParseError {
  code:
    | "unknown_command"
    | "unknown_option"
    | "missing_url"
    | "unexpected_argument";
  message: string;
  hint?: string;
}

/** Successful parse result. */
export interface CliParseSuccess {
  ok: true;
  value: CliCommand;
}

/** Failed parse result. */
export interface CliParseFailure {
  ok: false;
  error: CliParseError;
  exitCode: number;
}

/** Parse result union. */
export type CliParseResult = CliParseSuccess | CliParseFailure;

/** IO shape for writing CLI output in runtime/tests. */
export interface CliIo {
  stdout: {
    write: (chunk: string) => void;
  };
  stderr: {
    write: (chunk: string) => void;
  };
}

/** Runtime options for CLI execution. */
export interface RunCliOptions {
  env?: ProxyEnvironment;
  io?: CliIo;
  agentResolver?: ProxyAgentRouteResolver | null;
}
