import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  GatewayEnvelope,
  GatewayErrorPayload,
  HelloPayload,
  OutputPayload,
  PolicyUpdatePayload,
  SessionListPayload,
  CommandRelayClient,
  isAuthenticationError
} from "@commandrelay/client";

export type {
  GatewayEnvelope,
  GatewayErrorPayload,
  HelloPayload,
  OutputPayload,
  PolicyUpdatePayload,
  SessionListPayload,
  CommandRelayClient,
  isAuthenticationError
};

interface CommandRelayClientModule {
  CommandRelayClient: new (
    ...args: ConstructorParameters<typeof import("@commandrelay/client").CommandRelayClient>
  ) => import("@commandrelay/client").CommandRelayClient;
  isAuthenticationError: typeof import("@commandrelay/client").isAuthenticationError;
}

let commandRelayClientModule: Promise<CommandRelayClientModule> | null = null;

async function importFromSpecifier(specifier: string): Promise<CommandRelayClientModule | null> {
  try {
    return (await import(specifier)) as unknown as CommandRelayClientModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ERR_MODULE_NOT_FOUND" || /ERR_MODULE_NOT_FOUND/.test(message))
    ) {
      return null;
    }
    if (message.includes(`Cannot find package '${specifier}'`) || message.includes(`Cannot find package "${specifier}"`)) {
      return null;
    }
    throw error;
  }
}

function collectFallbackPaths(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRootCandidates: string[] = [];
  for (let cursor = moduleDir; cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (path.basename(cursor) === "packages") {
      packageRootCandidates.push(cursor);
      break;
    }
  }

  if (!packageRootCandidates.length) {
    packageRootCandidates.push(path.resolve(process.cwd(), "packages"));
    packageRootCandidates.push(path.resolve(process.cwd(), "..", "packages"));
  }

  const fallbackRoot = packageRootCandidates[0];
  return [
    path.join(process.cwd(), "packages", "commandrelay-client", "dist", "index.js"),
    path.join(process.cwd(), "packages", "commandrelay-client", "dist", "commandrelay-client", "src", "index.js"),
    path.join(fallbackRoot, "commandrelay-client", "dist", "index.js"),
    path.join(fallbackRoot, "commandrelay-client", "dist", "commandrelay-client", "src", "index.js"),
    path.join(moduleDir, "..", "commandrelay-client", "dist", "index.js"),
    path.join(moduleDir, "..", "commandrelay-client", "dist", "commandrelay-client", "src", "index.js"),
    path.join(moduleDir, "..", "dist", "commandrelay-client", "src", "index.js")
  ];
}

/**
 * Resolve {@link CommandRelayClient} and auth helpers with local fallback support.
 */
export async function loadCommandRelayClientModule(): Promise<CommandRelayClientModule> {
  if (commandRelayClientModule) {
    return commandRelayClientModule;
  }

  commandRelayClientModule = (async () => {
    const direct = await importFromSpecifier("@commandrelay/client");
    if (direct) return direct;

    for (const candidate of collectFallbackPaths()) {
      if (fs.existsSync(candidate)) {
        const importedModule = (await import(pathToFileURL(candidate).href)) as unknown;
        if (
          importedModule &&
          typeof importedModule === "object" &&
          "CommandRelayClient" in importedModule &&
          "isAuthenticationError" in importedModule
        ) {
          return importedModule as CommandRelayClientModule;
        }
      }
    }

    throw new Error(
      "Unable to resolve @commandrelay/client. Run `pnpm install` at repo root or rebuild packages via `pnpm -r run build`."
    );
  })();

  return commandRelayClientModule;
}
