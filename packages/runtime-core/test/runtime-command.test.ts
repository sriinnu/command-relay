/**
 * @file Unit tests for runtime command execution helpers.
 */

import assert from "node:assert/strict";
import { execPath } from "node:process";
import test from "node:test";
import { execRuntimeCommand, execRuntimeCommandWithInput } from "../src/index.js";

test("execRuntimeCommandWithInput pipes stdin through and returns stdout", async () => {
  const script = [
    "process.stdin.setEncoding('utf8');",
    "let input = '';",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => { process.stdout.write(input.toUpperCase()); });"
  ].join(" ");

  const output = await execRuntimeCommandWithInput(
    execPath,
    ["-e", script],
    "hello command relay\n",
    { timeoutMs: 2_000 }
  );

  assert.equal(output, "HELLO COMMAND RELAY\n");
});

test("execRuntimeCommandWithInput rejects when buffered output exceeds the cap", async () => {
  const script = "for (let i = 0; i < 5; i += 1) process.stdout.write('x'.repeat(1024 * 1024));";

  await assert.rejects(
    async () => {
      await execRuntimeCommandWithInput(execPath, ["-e", script], "", { timeoutMs: 5_000 });
    },
    /Command output exceeded 4194304 bytes/
  );
});

test("execRuntimeCommand rejects when the queued backlog exceeds the configured cap", { concurrency: false }, async () => {
  const previousConcurrent = process.env.COMMANDRELAY_RUNTIME_MAX_CONCURRENT_COMMANDS;
  const previousQueued = process.env.COMMANDRELAY_RUNTIME_MAX_QUEUED_COMMANDS;
  process.env.COMMANDRELAY_RUNTIME_MAX_CONCURRENT_COMMANDS = "1";
  process.env.COMMANDRELAY_RUNTIME_MAX_QUEUED_COMMANDS = "1";

  try {
    const script = "setTimeout(() => process.exit(0), 150);";
    const active = execRuntimeCommand(execPath, ["-e", script], { timeoutMs: 1_000 });
    const queued = execRuntimeCommand(execPath, ["-e", script], { timeoutMs: 1_000 });

    await assert.rejects(
      async () => {
        await execRuntimeCommand(execPath, ["-e", script], { timeoutMs: 1_000 });
      },
      /runtime command queue full/
    );

    await Promise.all([active, queued]);
  } finally {
    if (previousConcurrent === undefined) {
      delete process.env.COMMANDRELAY_RUNTIME_MAX_CONCURRENT_COMMANDS;
    } else {
      process.env.COMMANDRELAY_RUNTIME_MAX_CONCURRENT_COMMANDS = previousConcurrent;
    }

    if (previousQueued === undefined) {
      delete process.env.COMMANDRELAY_RUNTIME_MAX_QUEUED_COMMANDS;
    } else {
      process.env.COMMANDRELAY_RUNTIME_MAX_QUEUED_COMMANDS = previousQueued;
    }
  }
});
