import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { collectProtocolFallbackPaths } from "../src/protocol-runtime-loader.js";

test("collectProtocolFallbackPaths includes sibling protocol dist for flat dist output", () => {
  const repoRoot = path.resolve("tmp", "commandrelay");
  const importMetaUrl = pathToFileURL(
    path.join(repoRoot, "packages", "commandrelay-client", "dist", "index.js")
  ).href;

  const candidates = collectProtocolFallbackPaths(importMetaUrl, repoRoot);

  assert.ok(
    candidates.includes(path.join(repoRoot, "packages", "commandrelay-protocol", "dist", "index.js"))
  );
});

test("collectProtocolFallbackPaths includes sibling protocol dist for nested dist output", () => {
  const repoRoot = path.resolve("tmp", "commandrelay");
  const importMetaUrl = pathToFileURL(
    path.join(repoRoot, "packages", "commandrelay-client", "dist", "commandrelay-client", "src", "index.js")
  ).href;

  const candidates = collectProtocolFallbackPaths(importMetaUrl, repoRoot);

  assert.ok(
    candidates.includes(path.join(repoRoot, "packages", "commandrelay-protocol", "dist", "index.js"))
  );
});
