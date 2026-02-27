/**
 * @file Unit tests for strict SSH target parsing and profile name validation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { isValidSshProfileName, parseSshTarget } from "./ssh-target.js";

test("parseSshTarget accepts host-only targets", () => {
  assert.deepEqual(parseSshTarget("host"), {
    user: null,
    host: "host",
    raw: "host"
  });

  assert.deepEqual(parseSshTarget("host.local"), {
    user: null,
    host: "host.local",
    raw: "host.local"
  });

  assert.deepEqual(parseSshTarget("10.0.0.42"), {
    user: null,
    host: "10.0.0.42",
    raw: "10.0.0.42"
  });

  assert.deepEqual(parseSshTarget("[2001:db8::1]"), {
    user: null,
    host: "[2001:db8::1]",
    raw: "[2001:db8::1]"
  });
});

test("parseSshTarget accepts user@host targets", () => {
  assert.deepEqual(parseSshTarget("user@host"), {
    user: "user",
    host: "host",
    raw: "user@host"
  });

  assert.deepEqual(parseSshTarget("user.name@host.local"), {
    user: "user.name",
    host: "host.local",
    raw: "user.name@host.local"
  });

  assert.deepEqual(parseSshTarget("dev-user_1@192.168.1.25"), {
    user: "dev-user_1",
    host: "192.168.1.25",
    raw: "dev-user_1@192.168.1.25"
  });

  assert.deepEqual(parseSshTarget("alice@[2001:db8::1]"), {
    user: "alice",
    host: "[2001:db8::1]",
    raw: "alice@[2001:db8::1]"
  });
});

test("parseSshTarget rejects malformed targets", () => {
  const invalidTargets = [
    "",
    " ",
    "\t",
    "user @host",
    "user@ host",
    "user@ho st",
    "user@@host",
    "@host",
    "user@",
    "user@2001:db8::1",
    "user@[2001:db8::zzzz]",
    "user@[2001:db8::1]:22",
    "user@host:22",
    "user@999.1.2.3",
    "user@-host",
    "user@host-",
    "user@host..local",
    "user!@host",
    "user@[",
    "user@]"
  ];

  for (const input of invalidTargets) {
    assert.throws(() => {
      parseSshTarget(input);
    });
  }
});

test("isValidSshProfileName accepts safe profile identifiers", () => {
  const validNames = [
    "primary",
    "prod-us",
    "prod.us",
    "team_1",
    "A1",
    "ssh-profile-2026"
  ];

  for (const name of validNames) {
    assert.equal(isValidSshProfileName(name), true);
  }
});

test("isValidSshProfileName rejects unsafe or malformed profile identifiers", () => {
  const invalidNames = [
    "",
    " ",
    "has space",
    "@primary",
    "primary@",
    ".hidden",
    "-invalid",
    "bad/name",
    "name:prod",
    "name!",
    "name\tprod",
    "profile\nname",
    "x".repeat(129)
  ];

  for (const name of invalidNames) {
    assert.equal(isValidSshProfileName(name), false);
  }
});
