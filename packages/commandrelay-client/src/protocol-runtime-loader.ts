import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ProtocolModule = typeof import("@commandrelay/protocol");

let protocolRuntime: Promise<ProtocolModule> | null = null;

async function importFromSpecifier(specifier: string): Promise<ProtocolModule | null> {
  try {
    return (await import(specifier)) as ProtocolModule;
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

/**
 * Collect likely local workspace dist paths for `@commandrelay/protocol`.
 */
export function collectProtocolFallbackPaths(
  importMetaUrl: string = import.meta.url,
  cwd: string = process.cwd()
): string[] {
  const moduleDir = path.dirname(fileURLToPath(importMetaUrl));
  const packageRootCandidates: string[] = [];
  for (let cursor = moduleDir; cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (path.basename(cursor) === "packages") {
      packageRootCandidates.push(cursor);
      break;
    }
  }

  if (!packageRootCandidates.length) {
    packageRootCandidates.push(path.resolve(cwd, "packages"));
    packageRootCandidates.push(path.resolve(cwd, "..", "packages"));
  }

  const fallbackRoot = packageRootCandidates[0];
  const candidates = [
    path.join(cwd, "packages", "commandrelay-protocol", "dist", "index.js"),
    path.join(cwd, "packages", "commandrelay-protocol", "dist", "commandrelay-protocol", "src", "index.js"),
    path.join(fallbackRoot, "commandrelay-protocol", "dist", "index.js"),
    path.join(fallbackRoot, "commandrelay-protocol", "dist", "commandrelay-protocol", "src", "index.js"),
    path.join(moduleDir, "..", "..", "commandrelay-protocol", "dist", "index.js"),
    path.join(moduleDir, "..", "..", "commandrelay-protocol", "dist", "commandrelay-protocol", "src", "index.js"),
    path.join(moduleDir, "..", "..", "..", "commandrelay-protocol", "dist", "index.js"),
    path.join(moduleDir, "..", "..", "..", "commandrelay-protocol", "dist", "commandrelay-protocol", "src", "index.js")
  ];

  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

/**
 * Resolve the protocol runtime from package resolution first, then local workspace build output.
 */
export async function loadProtocolRuntime(): Promise<ProtocolModule> {
  if (protocolRuntime) {
    return protocolRuntime;
  }

  protocolRuntime = (async () => {
    const direct = await importFromSpecifier("@commandrelay/protocol");
    if (direct) {
      return direct;
    }

    for (const candidate of collectProtocolFallbackPaths()) {
      if (fs.existsSync(candidate)) {
        return (await import(pathToFileURL(candidate).href)) as ProtocolModule;
      }
    }

    throw new Error(
      "Unable to resolve @commandrelay/protocol. Run `pnpm install` at repo root or rebuild packages via `pnpm -r run build`."
    );
  })();

  return protocolRuntime;
}
