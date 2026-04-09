import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadRunLedgerRecord, resolveRunDirectory } from "../src/ledger.js";

test("resolveRunDirectory uses the nearest project root when unset", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-ledger-"));
  const projectRoot = path.join(tempRoot, "workspace");
  const nestedRoot = path.join(projectRoot, "apps", "web");
  await mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await mkdir(nestedRoot, { recursive: true });

  assert.equal(resolveRunDirectory({ baseDir: nestedRoot }), path.join(projectRoot, ".commandrelay", "runs"));
});

test("loadRunLedgerRecord upgrades older records with derived run directory fields", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "commandrelay-ledger-"));
  const runDirectory = path.join(tempRoot, ".commandrelay", "runs");
  const recordDirectory = path.join(runDirectory, "run_legacy");
  await mkdir(recordDirectory, { recursive: true });
  await writeFile(
    path.join(recordDirectory, "run.json"),
    JSON.stringify({
      runId: "run_legacy",
      runtime: "managed",
      title: "Legacy",
      command: "npm test",
      cwd: tempRoot,
      shell: "/bin/bash",
      detach: true,
      status: "running",
      paneId: "sess-1",
      sessionName: "legacy-session",
      attachCommand: "oly attach sess-1",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      ledgerPath: path.join(recordDirectory, "run.json")
    }),
    "utf8"
  );

  const record = await loadRunLedgerRecord("run_legacy", { runDirectory });

  assert.equal(record?.runDirectory, runDirectory);
  assert.equal(record?.lastSeenAt, "2026-04-09T00:00:00.000Z");
  assert.equal(record?.endedAt, null);
});
