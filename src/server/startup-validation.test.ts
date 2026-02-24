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

test("defaults strict protocol parsing on and supports legacy toggle alias", () => {
  const defaults = loadConfig({});
  const strictOffPrimary = loadConfig({ COMMANDRELAY_STRICT_PROTOCOL_PARSING: "false" });
  const strictOffAlias = loadConfig({ COMMANDRELAY_STRICT_V1: "0" });

  assert.equal(defaults.strictProtocolParsing, true);
  assert.equal(strictOffPrimary.strictProtocolParsing, false);
  assert.equal(strictOffAlias.strictProtocolParsing, false);
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
