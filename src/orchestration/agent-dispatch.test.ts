/**
 * @file Tests for deterministic spawn-agent dispatch template generation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DISPATCH_SAFETY_NOTICE,
  buildAgentDispatchMessage,
  buildSpawnAgentTemplate,
  parseTaskFromBrief,
  validateOwnedPaths
} from "./agent-dispatch.js";

test("parseTaskFromBrief extracts task from block Task section", () => {
  const task = parseTaskFromBrief([
    "Task:",
    "Implement deterministic dispatch payloads",
    "",
    "Owner:",
    "core-orchestration",
    "",
    "Brief Body:",
    "Use strict owned file validation."
  ].join("\n"));

  assert.equal(task, "Implement deterministic dispatch payloads");
});

test("parseTaskFromBrief extracts inline task text", () => {
  const task = parseTaskFromBrief([
    "Task: Implement deterministic dispatch payloads",
    "",
    "Owner:",
    "core-orchestration"
  ].join("\n"));

  assert.equal(task, "Implement deterministic dispatch payloads");
});

test("parseTaskFromBrief keeps multiline task text until next heading", () => {
  const task = parseTaskFromBrief([
    "Task:",
    "Implement deterministic dispatch payloads.",
    "Validate strict path policy.",
    "",
    "Owner:",
    "core-orchestration"
  ].join("\n"));

  assert.equal(
    task,
    [
      "Implement deterministic dispatch payloads.",
      "Validate strict path policy."
    ].join("\n")
  );
});

test("parseTaskFromBrief rejects missing and empty Task section", () => {
  assert.throws(
    () => parseTaskFromBrief("Owner:\ncore-orchestration"),
    /Task is required\. Provide `task` explicitly or include a "Task:" section in `briefBody`\./
  );
  assert.throws(
    () => parseTaskFromBrief(["Task:", "", "Owner:", "core-orchestration"].join("\n")),
    /Task section is present but empty\./
  );
});

test("validateOwnedPaths normalizes slashes, removes duplicates, and sorts", () => {
  const ownedPaths = validateOwnedPaths([
    " src\\orchestration\\agent-dispatch.ts ",
    "./src/orchestration/agent-dispatch.test.ts",
    "src/orchestration/agent-dispatch.ts"
  ]);

  assert.deepEqual(ownedPaths, [
    "src/orchestration/agent-dispatch.test.ts",
    "src/orchestration/agent-dispatch.ts"
  ]);
});

test("validateOwnedPaths rejects empty inputs and parent traversal paths", () => {
  assert.throws(
    () => validateOwnedPaths([]),
    /At least one owned path is required\./
  );
  assert.throws(
    () => validateOwnedPaths(["   "]),
    /ownedPaths\[0\] must be a non-empty path\./
  );
  assert.throws(
    () => validateOwnedPaths(["src/../orchestration/agent-dispatch.ts"]),
    /ownedPaths\[0\] cannot contain parent traversal segments \("\.\."\)\./
  );
});

test("buildAgentDispatchMessage builds deterministic text with parsed task fallback", () => {
  const message = buildAgentDispatchMessage({
    owner: "core-orchestration",
    ownedPaths: [
      "src/orchestration/agent-dispatch.test.ts",
      "src\\orchestration\\agent-dispatch.ts",
      "src/orchestration/agent-dispatch.ts"
    ],
    briefBody: [
      "Task:",
      "Implement production-ready dispatch template builder",
      "",
      "Expected Output:",
      "A deterministic spawn_agent payload template."
    ].join("\n")
  });

  assert.equal(
    message,
    [
      "Task:",
      "Implement production-ready dispatch template builder",
      "",
      "Owner:",
      "core-orchestration",
      "",
      "Owned Files:",
      "- src/orchestration/agent-dispatch.test.ts",
      "- src/orchestration/agent-dispatch.ts",
      "",
      "Additional Instructions:",
      "- none",
      "",
      "Safety Notice:",
      DISPATCH_SAFETY_NOTICE,
      "",
      "Brief Body:",
      "Task:",
      "Implement production-ready dispatch template builder",
      "",
      "Expected Output:",
      "A deterministic spawn_agent payload template.",
      ""
    ].join("\n")
  );
});

test("buildSpawnAgentTemplate returns deterministic spawn_agent shape", () => {
  const template = buildSpawnAgentTemplate({
    agentType: "claude-sonnet-4.5",
    owner: "core-orchestration",
    ownedPaths: [
      "src\\orchestration\\agent-dispatch.ts",
      "src/orchestration/agent-dispatch.test.ts"
    ],
    briefBody: [
      "Task:",
      "Implement deterministic dispatch template builder",
      "",
      "Notes:",
      "Cover parse and validation tests."
    ].join("\n")
  });

  assert.deepEqual(template, {
    agent_type: "claude-sonnet-4.5",
    message: [
      "Task:",
      "Implement deterministic dispatch template builder",
      "",
      "Owner:",
      "core-orchestration",
      "",
      "Owned Files:",
      "- src/orchestration/agent-dispatch.test.ts",
      "- src/orchestration/agent-dispatch.ts",
      "",
      "Additional Instructions:",
      "- none",
      "",
      "Safety Notice:",
      DISPATCH_SAFETY_NOTICE,
      "",
      "Brief Body:",
      "Task:",
      "Implement deterministic dispatch template builder",
      "",
      "Notes:",
      "Cover parse and validation tests.",
      ""
    ].join("\n"),
    metadata: {
      task: "Implement deterministic dispatch template builder",
      owner: "core-orchestration",
      owned_files: [
        "src/orchestration/agent-dispatch.test.ts",
        "src/orchestration/agent-dispatch.ts"
      ],
      additional_instructions: [],
      safety_notice: DISPATCH_SAFETY_NOTICE,
      brief_body: [
        "Task:",
        "Implement deterministic dispatch template builder",
        "",
        "Notes:",
        "Cover parse and validation tests."
      ].join("\n")
    }
  });
});

test("buildSpawnAgentTemplate includes normalized additional instructions", () => {
  const template = buildSpawnAgentTemplate({
    agentType: "worker",
    task: "Dispatch with extra instructions",
    owner: "core-orchestration",
    ownedPaths: ["src/orchestration/agent-dispatch.ts"],
    instructions: ["Keep output deterministic", "Keep output deterministic", "Use strict scope"],
    briefBody: "Task:\nDispatch with extra instructions"
  });

  assert.deepEqual(template.metadata.additional_instructions, [
    "Keep output deterministic",
    "Use strict scope"
  ]);
  assert.match(template.message, /Additional Instructions:\n- Keep output deterministic\n- Use strict scope/);
});

test("buildSpawnAgentTemplate allows explicit task override and validates required fields", () => {
  const template = buildSpawnAgentTemplate({
    agentType: "claude-sonnet-4.5",
    task: "Explicit task wins",
    owner: "core-orchestration",
    ownedPaths: ["src/orchestration/agent-dispatch.ts"],
    briefBody: "Owner:\ncore-orchestration"
  });

  assert.equal(template.metadata.task, "Explicit task wins");

  assert.throws(
    () =>
      buildSpawnAgentTemplate({
        agentType: "claude-sonnet-4.5",
        owner: "core-orchestration",
        ownedPaths: ["src/orchestration/agent-dispatch.ts"],
        briefBody: "Owner:\ncore-orchestration"
      }),
    /Task is required\. Provide `task` explicitly or include a "Task:" section in `briefBody`\./
  );
  assert.throws(
    () =>
      buildSpawnAgentTemplate({
        agentType: "  ",
        owner: "core-orchestration",
        ownedPaths: ["src/orchestration/agent-dispatch.ts"],
        briefBody: "Task:\nDo work"
      }),
    /agentType is required\./
  );
});
