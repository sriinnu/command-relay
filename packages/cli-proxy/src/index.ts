export { parseCliArgs } from "./arg-parser.js";
export { runCli } from "./cli-runner.js";
export { inspectProxyEnvironment } from "./env-inspector.js";
export {
  formatEnvironmentInspectionHuman,
  formatExplainRoutesHuman,
  formatHelpText,
  formatJson,
  formatParseError
} from "./formatter.js";
export { createOptionalProxyAgentResolver } from "./optional-agent.js";
export { explainProxyRoutes } from "./route-explainer.js";
export type {
  AgentSupport,
  CliCommand,
  CliIo,
  CliParseError,
  CliParseFailure,
  CliParseResult,
  CliParseSuccess,
  EnvCommand,
  ExplainCommand,
  ExplainRoutesOptions,
  ExplainRoutesResult,
  HelpCommand,
  ProxyAgentResolutionDetail,
  ProxyAgentRouteResolver,
  ProxyEnvironmentInspection,
  ProxyEnvironmentSnapshot,
  ProxySettingSource,
  ProxySnapshotKey,
  ProxyVariableResolution,
  RouteDecision,
  RouteExplanation,
  RunCliOptions
} from "./types.js";
