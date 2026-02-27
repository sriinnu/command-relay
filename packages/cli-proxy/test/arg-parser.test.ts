import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "../src/arg-parser.js";

test("returns help for empty argv", () => {
  const parsed = parseCliArgs([]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, "help");
  }
});

test("parses env command with json flag", () => {
  const parsed = parseCliArgs(["env", "--json"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      name: "env",
      json: true
    });
  }
});

test("parses explain command with default agent mode", () => {
  const parsed = parseCliArgs(["explain", "https://example.com"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      name: "explain",
      json: false,
      withAgent: true,
      urls: ["https://example.com"]
    });
  }
});

test("parses explain command with explicit no-agent mode", () => {
  const parsed = parseCliArgs(["explain", "--no-agent", "https://example.com"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, "explain");
    if (parsed.value.name === "explain") {
      assert.equal(parsed.value.withAgent, false);
    }
  }
});

test("supports global json flag", () => {
  const parsed = parseCliArgs(["--json", "env"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, "env");
    if (parsed.value.name === "env") {
      assert.equal(parsed.value.json, true);
    }
  }
});

test("fails on unknown command", () => {
  const parsed = parseCliArgs(["unknown"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "unknown_command");
  }
});

test("fails on missing explain urls", () => {
  const parsed = parseCliArgs(["explain", "--json"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "missing_url");
  }
});

test("fails on unknown env option", () => {
  const parsed = parseCliArgs(["env", "--bad"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "unknown_option");
  }
});
