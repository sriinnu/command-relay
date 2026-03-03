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
    workspace: "@termina/cli-proxy",
    actions: ["help", "info", "check", "build", "test", "cli"]
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
  "proxy-fetch": {
    id: "proxy-fetch",
    kind: "package",
    displayName: "Proxy Fetch",
    description: "Proxy-aware fetch helpers.",
    rootDir: "packages/proxy-fetch",
    skillPath: "packages/proxy-fetch/SKILL.md",
    svgPath: "packages/proxy-fetch/docs/assets/proxy-fetch-brand.svg",
    workspace: "@termina/proxy-fetch",
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
  "proxy-undici": {
    id: "proxy-undici",
    kind: "package",
    displayName: "Proxy Undici",
    description: "Proxy-aware Undici dispatcher factory.",
    rootDir: "packages/proxy-undici",
    skillPath: "packages/proxy-undici/SKILL.md",
    svgPath: "packages/proxy-undici/docs/assets/proxy-undici-brand.svg",
    workspace: "@termina/proxy-undici",
    actions: ["help", "info", "check", "build", "test"]
  }
};

