/**
 * @file Static allowlist registry for extension/app CLI routing.
 */

/**
 * Supported extension actions routed by `run-extension-cli`.
 */
export type ExtensionAction = "help" | "info" | "preview" | "check" | "build" | "test" | "cli";

/**
 * Extension descriptor used for discoverability and command routing.
 */
export interface ExtensionDefinition {
  id: string;
  kind: "app" | "package";
  displayName: string;
  description: string;
  rootDir: string;
  skillPath: string;
  svgPath: string;
  workspace?: string;
  actions: ExtensionAction[];
}

/**
 * Explicit allowlist of extension/app targets supported by CLI dispatch.
 */
export const EXTENSION_ALLOWLIST: Record<string, ExtensionDefinition> = {
  web: {
    id: "web",
    kind: "app",
    displayName: "Web App",
    description: "Main browser-facing app surface.",
    rootDir: "apps/web",
    skillPath: "apps/web/SKILL.md",
    svgPath: "apps/web/assets/brand.svg",
    actions: ["help", "info", "preview"]
  },
  "cli-proxy": {
    id: "cli-proxy",
    kind: "package",
    displayName: "CLI Proxy",
    description: "Proxy diagnostics CLI extension.",
    rootDir: "packages/cli-proxy",
    skillPath: "packages/cli-proxy/SKILL.md",
    svgPath: "packages/cli-proxy/docs/assets/cli-proxy-brand.svg",
    workspace: "@commandrelay/cli-proxy",
    actions: ["help", "info", "check", "build", "test", "cli"]
  },
  "commandrelay-client": {
    id: "commandrelay-client",
    kind: "package",
    displayName: "CommandRelay Client",
    description: "Typed websocket client primitives for CommandRelay protocol operations.",
    rootDir: "packages/commandrelay-client",
    skillPath: "packages/commandrelay-client/SKILL.md",
    svgPath: "",
    workspace: "@commandrelay/client",
    actions: ["help", "info", "check", "build"]
  },
  "commandrelay-protocol": {
    id: "commandrelay-protocol",
    kind: "package",
    displayName: "CommandRelay Protocol",
    description: "Shared protocol constants and parsers for CommandRelay envelopes.",
    rootDir: "packages/commandrelay-protocol",
    skillPath: "packages/commandrelay-protocol/SKILL.md",
    svgPath: "",
    workspace: "@commandrelay/protocol",
    actions: ["help", "info", "check", "build"]
  },
  "commandrelay-relay-proxy": {
    id: "commandrelay-relay-proxy",
    kind: "package",
    displayName: "CommandRelay Relay Proxy",
    description: "WebSocket relay sidecar for protected/observability-aware upstream control.",
    rootDir: "packages/commandrelay-relay-proxy",
    skillPath: "packages/commandrelay-relay-proxy/SKILL.md",
    svgPath: "",
    workspace: "@commandrelay/relay-proxy",
    actions: ["help", "info", "check", "build", "test", "cli"]
  },
  "commandrelay-tui": {
    id: "commandrelay-tui",
    kind: "package",
    displayName: "CommandRelay TUI",
    description: "Cross-platform terminal UI client for CommandRelay gateways.",
    rootDir: "packages/commandrelay-tui",
    skillPath: "packages/commandrelay-tui/SKILL.md",
    svgPath: "",
    workspace: "@commandrelay/tui",
    actions: ["help", "info", "check", "build", "cli"]
  },
  "proxy-agent": {
    id: "proxy-agent",
    kind: "package",
    displayName: "Proxy Agent",
    description: "Protocol-aware proxy agent factory.",
    rootDir: "packages/proxy-agent",
    skillPath: "packages/proxy-agent/SKILL.md",
    svgPath: "packages/proxy-agent/docs/assets/proxy-agent-brand.svg",
    workspace: "@commandrelay/proxy-agent",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-axios": {
    id: "proxy-axios",
    kind: "package",
    displayName: "Proxy Axios",
    description: "Axios-friendly proxy resolver and request config helpers.",
    rootDir: "packages/proxy-axios",
    skillPath: "packages/proxy-axios/SKILL.md",
    svgPath: "packages/proxy-axios/docs/assets/proxy-axios-brand.svg",
    workspace: "@commandrelay/proxy-axios",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-core": {
    id: "proxy-core",
    kind: "package",
    displayName: "Proxy Core",
    description: "Core proxy settings and resolution utilities.",
    rootDir: "packages/proxy-core",
    skillPath: "packages/proxy-core/SKILL.md",
    svgPath: "packages/proxy-core/docs/assets/proxy-core-brand.svg",
    workspace: "@commandrelay/proxy-core",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-got": {
    id: "proxy-got",
    kind: "package",
    displayName: "Proxy Got",
    description: "Got-friendly proxy resolver and apply helpers.",
    rootDir: "packages/proxy-got",
    skillPath: "packages/proxy-got/SKILL.md",
    svgPath: "packages/proxy-got/docs/assets/proxy-got-brand.svg",
    workspace: "@commandrelay/proxy-got",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-fetch": {
    id: "proxy-fetch",
    kind: "package",
    displayName: "Proxy Fetch",
    description: "Proxy-aware fetch helpers.",
    rootDir: "packages/proxy-fetch",
    skillPath: "packages/proxy-fetch/SKILL.md",
    svgPath: "packages/proxy-fetch/docs/assets/proxy-fetch-brand.svg",
    workspace: "@commandrelay/proxy-fetch",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-http-client": {
    id: "proxy-http-client",
    kind: "package",
    displayName: "Proxy HTTP Client",
    description: "Proxy-aware JSON HTTP client.",
    rootDir: "packages/proxy-http-client",
    skillPath: "packages/proxy-http-client/SKILL.md",
    svgPath: "packages/proxy-http-client/docs/assets/proxy-http-client-brand.svg",
    workspace: "@commandrelay/proxy-http-client",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-runtime": {
    id: "proxy-runtime",
    kind: "package",
    displayName: "Proxy Runtime",
    description: "Runtime-level proxy decision controller and lifecycle utilities.",
    rootDir: "packages/proxy-runtime",
    skillPath: "packages/proxy-runtime/SKILL.md",
    svgPath: "packages/proxy-runtime/docs/assets/proxy-runtime-brand.svg",
    workspace: "@commandrelay/proxy-runtime",
    actions: ["help", "info", "check", "build", "test"]
  },
  "proxy-undici": {
    id: "proxy-undici",
    kind: "package",
    displayName: "Proxy Undici",
    description: "Proxy-aware Undici dispatcher factory.",
    rootDir: "packages/proxy-undici",
    skillPath: "packages/proxy-undici/SKILL.md",
    svgPath: "packages/proxy-undici/docs/assets/proxy-undici-brand.svg",
    workspace: "@commandrelay/proxy-undici",
    actions: ["help", "info", "check", "build", "test"]
  }
};
