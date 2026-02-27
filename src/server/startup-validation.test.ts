/**
 * @file Tests for startup config validation and env parsing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateStartupConfig } from "../config.js";

test("parses global input kill switch truthy and falsy values", () => {
  const enabled = loadConfig({ COMMANDRELAY_INPUT_KILL_SWITCH: "true" });
  const disabled = loadConfig({ COMMANDRELAY_INPUT_KILL_SWITCH: "off" });

  assert.equal(enabled.globalInputDisabled, true);
  assert.equal(disabled.globalInputDisabled, false);
});

test("parses lane lease duration with bounded defaults", () => {
  const defaults = loadConfig({});
  const custom = loadConfig({ COMMANDRELAY_INPUT_LANE_LEASE_MS: "45000" });
  const tooLow = loadConfig({ COMMANDRELAY_INPUT_LANE_LEASE_MS: "999" });
  const tooHigh = loadConfig({ COMMANDRELAY_INPUT_LANE_LEASE_MS: "300001" });
  const invalid = loadConfig({ COMMANDRELAY_INPUT_LANE_LEASE_MS: "invalid" });

  assert.equal(defaults.inputLaneLeaseMs, 30_000);
  assert.equal(custom.inputLaneLeaseMs, 45_000);
  assert.equal(tooLow.inputLaneLeaseMs, 30_000);
  assert.equal(tooHigh.inputLaneLeaseMs, 30_000);
  assert.equal(invalid.inputLaneLeaseMs, 30_000);
});

test("defaults strict protocol parsing on and supports legacy toggle alias", () => {
  const defaults = loadConfig({});
  const strictOffPrimary = loadConfig({ COMMANDRELAY_STRICT_PROTOCOL_PARSING: "false" });
  const strictOffAlias = loadConfig({ COMMANDRELAY_STRICT_V1: "0" });

  assert.equal(defaults.strictProtocolParsing, true);
  assert.equal(strictOffPrimary.strictProtocolParsing, false);
  assert.equal(strictOffAlias.strictProtocolParsing, false);
});

test("defaults runtime backend list to tmux", () => {
  const config = loadConfig({});
  assert.deepEqual(config.runtimeBackends, ["tmux"]);
});

test("defaults cmux command to cmux", () => {
  const config = loadConfig({});
  assert.equal(config.cmuxCommand, "cmux");
});

test("parses and trims cmux command env value", () => {
  const custom = loadConfig({ COMMANDRELAY_CMUX_COMMAND: "  /opt/bin/cmux  " });
  const blank = loadConfig({ COMMANDRELAY_CMUX_COMMAND: "   " });

  assert.equal(custom.cmuxCommand, "/opt/bin/cmux");
  assert.equal(blank.cmuxCommand, "cmux");
});

test("parses, normalizes, and deduplicates runtime backend list", () => {
  const config = loadConfig({
    COMMANDRELAY_RUNTIME_BACKENDS: " tmux , cmux,tmux "
  });
  assert.deepEqual(config.runtimeBackends, ["tmux", "cmux"]);
});

test("rejects unsupported runtime backend values", () => {
  assert.throws(
    () => loadConfig({ COMMANDRELAY_RUNTIME_BACKENDS: "tmux,screen" }),
    /COMMANDRELAY_RUNTIME_BACKENDS/
  );
});

test("rejects invalid global input kill switch values", () => {
  assert.throws(
    () => loadConfig({ COMMANDRELAY_INPUT_KILL_SWITCH: "sometimes" }),
    /COMMANDRELAY_INPUT_KILL_SWITCH/
  );
});

test("requires auth token when binding on a non-loopback host", () => {
  const config = loadConfig({ COMMANDRELAY_HOST: "0.0.0.0" });
  assert.throws(() => validateStartupConfig(config), /COMMANDRELAY_AUTH_TOKEN/);
});

test("accepts loopback host without auth and non-loopback host with auth", () => {
  const localConfig = loadConfig({ COMMANDRELAY_HOST: "127.0.0.1" });
  validateStartupConfig(localConfig);

  const remoteConfig = loadConfig({
    COMMANDRELAY_HOST: "0.0.0.0",
    COMMANDRELAY_AUTH_TOKEN: "token-value"
  });
  validateStartupConfig(remoteConfig);
});

test("defaults transport to ws with ssh-safe defaults", () => {
  const config = loadConfig({});

  assert.equal(config.transportMode, "ws");
  assert.equal(config.sshProfileName, "primary");
  assert.equal(config.sshPort, 22);
  assert.equal(config.sshCommand, "ssh");
  assert.equal(config.sshConnectTimeoutSeconds, 8);
  assert.equal(config.sshStrictHostKeyChecking, true);
});

test("parses and validates ssh profile names", () => {
  const trimmed = loadConfig({ COMMANDRELAY_SSH_PROFILE: "  primary.ops-1_2  " });
  assert.equal(trimmed.sshProfileName, "primary.ops-1_2");

  assert.throws(() => loadConfig({ COMMANDRELAY_SSH_PROFILE: "   " }), /COMMANDRELAY_SSH_PROFILE/);
  assert.throws(
    () => loadConfig({ COMMANDRELAY_SSH_PROFILE: "primary/profile" }),
    /COMMANDRELAY_SSH_PROFILE/
  );
});

test("parses ssh transport mode", () => {
  const config = loadConfig({ COMMANDRELAY_TRANSPORT_MODE: "ssh" });

  assert.equal(config.transportMode, "ssh");
});

test("parses and trims ssh command env value", () => {
  const custom = loadConfig({ COMMANDRELAY_SSH_COMMAND: "  /usr/bin/ssh  " });
  const blank = loadConfig({ COMMANDRELAY_SSH_COMMAND: "   " });

  assert.equal(custom.sshCommand, "/usr/bin/ssh");
  assert.equal(blank.sshCommand, "ssh");
});

test("parses ssh connect timeout override when value is valid", () => {
  const config = loadConfig({ COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS: "15" });
  assert.equal(config.sshConnectTimeoutSeconds, 15);
});

test("rejects invalid ssh connect timeout values", () => {
  assert.throws(
    () => loadConfig({ COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS: "0" }),
    /COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS/
  );
  assert.throws(
    () => loadConfig({ COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS: "61" }),
    /COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS/
  );
  assert.throws(
    () => loadConfig({ COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS: "8.5" }),
    /COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS/
  );
});

test("rejects invalid transport mode values", () => {
  assert.throws(
    () => loadConfig({ COMMANDRELAY_TRANSPORT_MODE: "serial" }),
    /COMMANDRELAY_TRANSPORT_MODE/
  );
});

test("requires ssh target when transport mode is ssh", () => {
  const config = loadConfig({
    COMMANDRELAY_TRANSPORT_MODE: "ssh"
  });

  assert.throws(() => validateStartupConfig(config), /COMMANDRELAY_SSH_TARGET/);
});

test("accepts ssh transport mode when ssh target is provided", () => {
  const config = loadConfig({
    COMMANDRELAY_TRANSPORT_MODE: "ssh",
    COMMANDRELAY_SSH_TARGET: "relay@example.internal"
  });

  validateStartupConfig(config);
});

test("rejects non-tmux runtime backends when transport mode is ssh", () => {
  const config = loadConfig({
    COMMANDRELAY_TRANSPORT_MODE: "ssh",
    COMMANDRELAY_SSH_TARGET: "relay@example.internal",
    COMMANDRELAY_RUNTIME_BACKENDS: "tmux,cmux"
  });

  assert.throws(
    () => validateStartupConfig(config),
    /COMMANDRELAY_RUNTIME_BACKENDS.*COMMANDRELAY_TRANSPORT_MODE/
  );
});

test("rejects invalid ssh target format when provided", () => {
  assert.throws(
    () => loadConfig({ COMMANDRELAY_SSH_TARGET: "relay target" }),
    /COMMANDRELAY_SSH_TARGET/
  );
  assert.throws(() => loadConfig({ COMMANDRELAY_SSH_TARGET: "relay@@example" }), /COMMANDRELAY_SSH_TARGET/);
  assert.throws(() => loadConfig({ COMMANDRELAY_SSH_TARGET: "ops@" }), /COMMANDRELAY_SSH_TARGET/);
});

test("accepts valid ssh target formats", () => {
  const hostOnly = loadConfig({ COMMANDRELAY_SSH_TARGET: "example.internal" });
  const userAndHost = loadConfig({ COMMANDRELAY_SSH_TARGET: "ops-user@example-1.internal" });
  const ipv6 = loadConfig({ COMMANDRELAY_SSH_TARGET: "ops@[2001:db8::1]" });

  assert.equal(hostOnly.sshTarget, "example.internal");
  assert.equal(userAndHost.sshTarget, "ops-user@example-1.internal");
  assert.equal(ipv6.sshTarget, "ops@[2001:db8::1]");
});

test("parses ssh port override when value is valid", () => {
  const config = loadConfig({ COMMANDRELAY_SSH_PORT: "2202" });
  assert.equal(config.sshPort, 2202);
});

test("rejects invalid ssh port values", () => {
  assert.throws(() => loadConfig({ COMMANDRELAY_SSH_PORT: "0" }), /COMMANDRELAY_SSH_PORT/);
  assert.throws(() => loadConfig({ COMMANDRELAY_SSH_PORT: "70000" }), /COMMANDRELAY_SSH_PORT/);
  assert.throws(() => loadConfig({ COMMANDRELAY_SSH_PORT: "22.5" }), /COMMANDRELAY_SSH_PORT/);
});

test("parses strict host key env and rejects invalid values", () => {
  const disabled = loadConfig({ COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING: "off" });
  assert.equal(disabled.sshStrictHostKeyChecking, false);

  assert.throws(
    () => loadConfig({ COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING: "sometimes" }),
    /COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING/
  );
});
