/**
 * @file Unit tests for bridge server utility helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  groupSessionsByName,
  PaneInputOwnershipArbiter,
  snapshotPaneInputOwnership
} from "./bridge-server-utils.js";

test("groupSessionsByName groups panes by session name for single backend rows", () => {
  const grouped = groupSessionsByName([
    { sessionName: "main", paneId: "%1" },
    { sessionName: "main", paneId: "%2" },
    { sessionName: "ops", paneId: "%3" }
  ]);

  assert.deepEqual(grouped, [
    { sessionName: "main", paneIds: ["%1", "%2"] },
    { sessionName: "ops", paneIds: ["%3"] }
  ]);
});

test("groupSessionsByName isolates identical session names across backends", () => {
  const grouped = groupSessionsByName([
    { sessionName: "main", paneId: "tmux:%1", backendId: "tmux" },
    { sessionName: "main", paneId: "cmux:surface-1", backendId: "cmux" },
    { sessionName: "main", paneId: "tmux:%2", backendId: "tmux" }
  ]);

  assert.deepEqual(grouped, [
    { sessionName: "main", paneIds: ["tmux:%1", "tmux:%2"], backendId: "tmux" },
    { sessionName: "main", paneIds: ["cmux:surface-1"], backendId: "cmux" }
  ]);
});

test("groupSessionsByName skips rows with invalid paneId", () => {
  const grouped = groupSessionsByName([
    { sessionName: "main", paneId: "" },
    { sessionName: "main" },
    { sessionName: "main", paneId: "%1" }
  ]);

  assert.deepEqual(grouped, [{ sessionName: "main", paneIds: ["%1"] }]);
});

test("PaneInputOwnershipArbiter preserves baseline claim behavior", () => {
  const arbiter = new PaneInputOwnershipArbiter({ now: () => 0 });

  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });
  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });
  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: false,
    ownerClientId: "client-a",
    overrideAllowed: false
  });
  assert.deepEqual(arbiter.claim("pane-1", "client-b", true, true), {
    ok: true,
    overridden: true
  });
});

test("PaneInputOwnershipArbiter expires stale owners before claim checks", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 50,
    now: () => nowMs
  });

  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 49;
  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: false,
    ownerClientId: "client-a",
    overrideAllowed: false
  });

  nowMs = 50;
  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: true,
    overridden: false
  });
});

test("PaneInputOwnershipArbiter refreshes lease when the same owner reclaims", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 50,
    now: () => nowMs
  });

  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 40;
  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 79;
  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: false,
    ownerClientId: "client-a",
    overrideAllowed: false
  });

  nowMs = 90;
  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: true,
    overridden: false
  });
});

test("PaneInputOwnershipArbiter falls back to safe lease defaults", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: -1,
    now: () => nowMs
  });

  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 1;
  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: false,
    ownerClientId: "client-a",
    overrideAllowed: false
  });
});

test("PaneInputOwnershipArbiter expires stale owners before release checks", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 25,
    now: () => nowMs
  });

  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });
  assert.deepEqual(arbiter.claim("pane-2", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 25;
  assert.equal(arbiter.releaseClient("client-a"), 0);

  assert.deepEqual(arbiter.claim("pane-1", "client-b", false, false), {
    ok: true,
    overridden: false
  });
});

test("PaneInputOwnershipArbiter expires stale owners before releasePaneIfOwnedBy checks", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 10,
    now: () => nowMs
  });

  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 10;
  arbiter.releasePaneIfOwnedBy("pane-1", "client-b");

  assert.deepEqual(arbiter.claim("pane-1", "client-c", false, false), {
    ok: true,
    overridden: false
  });
});

test("PaneInputOwnershipArbiter snapshot reports deterministic lane ownership rows", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 50,
    now: () => nowMs
  });

  assert.deepEqual(arbiter.claim("pane-b", "client-b", false, false), {
    ok: true,
    overridden: false
  });
  nowMs = 10;
  assert.deepEqual(arbiter.claim("pane-a", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 20;
  assert.deepEqual(arbiter.snapshot(), [
    {
      paneId: "pane-a",
      ownerClientId: "client-a",
      expiresAtMs: 60
    },
    {
      paneId: "pane-b",
      ownerClientId: "client-b",
      expiresAtMs: 50
    }
  ]);
});

test("PaneInputOwnershipArbiter snapshot excludes expired lane owners", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 10,
    now: () => nowMs
  });
  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 10;
  assert.deepEqual(arbiter.snapshot(), []);
});

test("snapshotPaneInputOwnership serializes legacy ownership maps", () => {
  const legacy = new Map<string, string>([
    ["pane-b", "client-b"],
    ["pane-a", "client-a"]
  ]);

  assert.deepEqual(snapshotPaneInputOwnership(legacy), [
    {
      paneId: "pane-a",
      ownerClientId: "client-a",
      expiresAtMs: null
    },
    {
      paneId: "pane-b",
      ownerClientId: "client-b",
      expiresAtMs: null
    }
  ]);
});

test("snapshotPaneInputOwnership returns empty rows when arbitration is off", () => {
  assert.deepEqual(snapshotPaneInputOwnership(undefined), []);
});

test("snapshotPaneInputOwnership uses arbiter snapshot rows", () => {
  let nowMs = 0;
  const arbiter = new PaneInputOwnershipArbiter({
    leaseDurationMs: 25,
    now: () => nowMs
  });
  assert.deepEqual(arbiter.claim("pane-1", "client-a", false, false), {
    ok: true,
    overridden: false
  });

  nowMs = 5;
  assert.deepEqual(snapshotPaneInputOwnership(arbiter), [
    {
      paneId: "pane-1",
      ownerClientId: "client-a",
      expiresAtMs: 25
    }
  ]);
});
