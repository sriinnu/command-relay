/**
 * @file Unit tests for SSH session state machine transitions and guards.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SSH_SESSION_INITIAL_STATE,
  canEnableInputFromState,
  isInputEnabledState,
  isTransitionAllowed,
  transitionSshSessionState,
  type SshSessionControlState,
  type SshSessionTransitionEvent
} from "./session-state-machine.js";

interface ValidTransitionCase {
  from: SshSessionControlState;
  event: SshSessionTransitionEvent;
  to: SshSessionControlState;
}

const VALID_TRANSITIONS: ValidTransitionCase[] = [
  { from: "offline", event: "start_connect", to: "connecting" },
  { from: "connecting", event: "connect_succeeded", to: "connected" },
  { from: "connecting", event: "connect_failed", to: "offline" },
  { from: "connecting", event: "disconnect", to: "offline" },
  { from: "connected", event: "attach", to: "attached" },
  { from: "connected", event: "disconnect", to: "offline" },
  { from: "connected", event: "connection_lost", to: "reconnecting" },
  { from: "attached", event: "detach", to: "connected" },
  { from: "attached", event: "disconnect", to: "offline" },
  { from: "attached", event: "connection_lost", to: "reconnecting" },
  { from: "reconnecting", event: "reconnect_succeeded", to: "connected" },
  { from: "reconnecting", event: "reconnect_failed", to: "offline" },
  { from: "reconnecting", event: "begin_replay", to: "replaying" },
  { from: "reconnecting", event: "disconnect", to: "offline" },
  { from: "replaying", event: "replay_completed", to: "attached" },
  { from: "replaying", event: "replay_failed", to: "connected" },
  { from: "replaying", event: "connection_lost", to: "reconnecting" },
  { from: "replaying", event: "disconnect", to: "offline" }
];

const ALL_STATES: SshSessionControlState[] = [
  "offline",
  "connecting",
  "connected",
  "attached",
  "reconnecting",
  "replaying"
];

const ALL_EVENTS: SshSessionTransitionEvent[] = [
  "start_connect",
  "connect_succeeded",
  "connect_failed",
  "disconnect",
  "attach",
  "connection_lost",
  "detach",
  "reconnect_succeeded",
  "reconnect_failed",
  "begin_replay",
  "replay_completed",
  "replay_failed"
];

test("exports offline as canonical initial state", () => {
  assert.equal(SSH_SESSION_INITIAL_STATE, "offline");
});

test("accepts every valid transition and emits deterministic log metadata", () => {
  VALID_TRANSITIONS.forEach((entry, index) => {
    const context = { sequence: index + 1, atMs: 1_700_000_000_000 + index };
    const result = transitionSshSessionState(entry.from, entry.event, context);

    assert.equal(result.state, entry.to);
    assert.equal(result.changed, entry.to !== entry.from);
    assert.deepEqual(result.log, {
      sequence: context.sequence,
      atMs: context.atMs,
      from: entry.from,
      event: entry.event,
      to: entry.to,
      accepted: true,
      reason: null
    });
  });
});

test("rejects invalid transitions and keeps state unchanged", () => {
  const validKeySet = new Set(VALID_TRANSITIONS.map((entry) => `${entry.from}:${entry.event}`));

  let rejectedCount = 0;
  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (validKeySet.has(`${state}:${event}`)) {
        continue;
      }

      const context = { sequence: 10_000 + rejectedCount, atMs: 1_800_000_000_000 + rejectedCount };
      const result = transitionSshSessionState(state, event, context);

      assert.equal(result.state, state);
      assert.equal(result.changed, false);
      assert.deepEqual(result.log, {
        sequence: context.sequence,
        atMs: context.atMs,
        from: state,
        event,
        to: state,
        accepted: false,
        reason: "invalid_transition"
      });
      rejectedCount += 1;
    }
  }

  assert.equal(rejectedCount, ALL_STATES.length * ALL_EVENTS.length - VALID_TRANSITIONS.length);
});

test("isTransitionAllowed matches transition matrix", () => {
  const validKeySet = new Set(VALID_TRANSITIONS.map((entry) => `${entry.from}:${entry.event}`));

  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      assert.equal(isTransitionAllowed(state, event), validKeySet.has(`${state}:${event}`));
    }
  }
});

test("input helper predicates return expected capability by state", () => {
  const enabledStates = ALL_STATES.filter((state) => isInputEnabledState(state));
  const capableStates = ALL_STATES.filter((state) => canEnableInputFromState(state));

  assert.deepEqual(enabledStates, ["attached"]);
  assert.deepEqual(capableStates, ["connected", "attached", "replaying"]);
});
