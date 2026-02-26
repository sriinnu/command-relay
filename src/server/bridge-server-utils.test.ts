/**
 * @file Unit tests for bridge server utility helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { groupSessionsByName } from "./bridge-server-utils.js";

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
