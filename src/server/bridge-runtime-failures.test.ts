/**
 * @file Unit tests for runtime failure classifiers used by bridge server handlers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { classifyBridgeRuntimeFailure } from "./bridge-runtime-failures.js";

test("classifies tmux no-server failures as recoverable runtime session loss", () => {
  const failure = classifyBridgeRuntimeFailure({
    message: "tmux failed",
    stderr: "no server running on /tmp/tmux-1000/default"
  });
  assert.equal(failure.code, "runtime_session_unavailable");
  assert.equal(failure.reason, "tmux_session_unavailable");
  assert.equal(failure.recoverable, true);
});

test("classifies transport disconnect failures as recoverable transport drops", () => {
  const failure = classifyBridgeRuntimeFailure({
    message: "ssh stream failed",
    stderr: "write EPIPE broken pipe"
  });
  assert.equal(failure.code, "transport_drop");
  assert.equal(failure.reason, "transport_closed");
  assert.equal(failure.recoverable, true);
});

test("classifies multiplexer pane routing failures as invalid pane targets", () => {
  const failure = classifyBridgeRuntimeFailure({
    message: "Unknown runtime backend \"ghost\" for pane id \"ghost:%1\""
  });
  assert.equal(failure.code, "invalid_pane_target");
  assert.equal(failure.reason, "unknown_runtime_backend");
  assert.equal(failure.recoverable, false);
});
