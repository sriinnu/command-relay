import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRunWrappedCommand, loadRunExitMarker } from "../src/run-exit-marker.js";

test("buildRunWrappedCommand emits a posix wrapper with exit marker write", () => {
  const wrapped = buildRunWrappedCommand("npm test", "/bin/bash", "/tmp/run/exit.json");
  assert.match(wrapped, /npm test/);
  assert.match(wrapped, /exitCode/);
  assert.match(wrapped, /__cr_exit/);
});

test("loadRunExitMarker parses numeric exit codes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-exit-"));
  const exitPath = path.join(tempRoot, "exit.json");
  await writeFile(exitPath, JSON.stringify({ exitCode: 2, endedAt: "2026-04-09T12:00:00.000Z" }), "utf8");

  const marker = await loadRunExitMarker(exitPath);

  assert.deepEqual(marker, {
    exitCode: 2,
    endedAt: "2026-04-09T12:00:00.000Z"
  });
});
