/**
 * @file Conformance tests for input policy behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildInputPolicyState, isInputAllowed } from "./input-policy.js";

test("builds enabled policy state when client input is enabled and kill switch is off", () => {
  const policy = buildInputPolicyState({
    clientInputEnabled: true,
    globalInputDisabled: false
  });

  assert.equal(policy.inputEnabled, true);
  assert.equal(policy.globalInputDisabled, false);
  assert.equal(isInputAllowed({ clientInputEnabled: true, globalInputDisabled: false }), true);
});

test("forces read-only policy state when kill switch is on", () => {
  const policy = buildInputPolicyState({
    clientInputEnabled: true,
    globalInputDisabled: true
  });

  assert.equal(policy.inputEnabled, false);
  assert.equal(policy.globalInputDisabled, true);
  assert.equal(isInputAllowed({ clientInputEnabled: true, globalInputDisabled: true }), false);
});
