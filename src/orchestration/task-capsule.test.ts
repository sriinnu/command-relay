/**
 * @file Tests for task capsule builder and selector parsing helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TASK_CAPSULE_CONSTRAINTS,
  TASK_CAPSULE_SCHEMA_VERSION,
  buildTaskCapsule,
  parseFileSnippetSelector
} from "./task-capsule.js";

test("parseFileSnippetSelector parses ranges and applies safe line bounds", () => {
  assert.deepEqual(parseFileSnippetSelector("src/index.ts:5:12"), {
    path: "src/index.ts",
    startLine: 5,
    endLine: 12
  });

  assert.deepEqual(parseFileSnippetSelector("src/index.ts:-9:2"), {
    path: "src/index.ts",
    startLine: 1,
    endLine: 2
  });

  assert.deepEqual(parseFileSnippetSelector("src/index.ts:80:3"), {
    path: "src/index.ts",
    startLine: 80,
    endLine: 80
  });

  assert.deepEqual(
    parseFileSnippetSelector("src/index.ts:10:999999", { lineMax: 20 }),
    {
      path: "src/index.ts",
      startLine: 10,
      endLine: 20
    }
  );

  assert.deepEqual(parseFileSnippetSelector("C:\\repo\\file.ts:7:9"), {
    path: "C:\\repo\\file.ts",
    startLine: 7,
    endLine: 9
  });
});

test("parseFileSnippetSelector rejects invalid selector and bound configuration", () => {
  assert.throws(
    () => parseFileSnippetSelector("   "),
    /Snippet selector must be a non-empty string\./
  );
  assert.throws(
    () => parseFileSnippetSelector(":1:2"),
    /Snippet selector path must be non-empty\./
  );
  assert.throws(
    () => parseFileSnippetSelector("src/index.ts:1:2", { lineMin: 10, lineMax: 2 }),
    /Invalid selector bounds: lineMin cannot exceed lineMax\./
  );
  assert.throws(
    () => parseFileSnippetSelector("src/index.ts:1:2", { lineMin: 0 }),
    /lineMin must be a positive integer\./
  );
});

test("buildTaskCapsule truncates snippet content using default maxSnippetChars", () => {
  const oversizedContent = "x".repeat(DEFAULT_TASK_CAPSULE_CONSTRAINTS.maxSnippetChars + 30);

  const capsule = buildTaskCapsule({
    goal: "Deliver distilled capsule",
    owner: "orchestration",
    snippets: [
      {
        selector: "src/server/bridge-server.ts:10:20",
        content: oversizedContent
      }
    ]
  });

  assert.equal(capsule.snippets.length, 1);
  assert.equal(capsule.snippets[0].content.length, DEFAULT_TASK_CAPSULE_CONSTRAINTS.maxSnippetChars);
});

test("buildTaskCapsule truncates to empty content when maxSnippetChars is zero", () => {
  const capsule = buildTaskCapsule(
    {
      goal: "Zero truncation",
      owner: "orchestration",
      snippets: [
        {
          selector: "src/server/bridge-server.ts:10:20",
          content: "non-empty"
        }
      ]
    },
    {
      constraints: {
        maxSnippetChars: 0
      }
    }
  );

  assert.equal(capsule.snippets.length, 1);
  assert.equal(capsule.snippets[0].content, "");
});

test("buildTaskCapsule returns schema with selected fields only", () => {
  const capsule = buildTaskCapsule({
    goal: "Ship distilled capsule",
    owner: "capsule-owner",
    paths: ["src/a.ts"],
    acceptanceCriteria: ["first", "first", "second"],
    risks: ["risk-a"],
    snippets: [
      {
        selector: "src/a.ts:2:3",
        content: "alpha\nbeta"
      }
    ]
  });

  assert.equal(capsule.schemaVersion, TASK_CAPSULE_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(capsule).sort(), [
    "acceptanceCriteria",
    "goal",
    "owner",
    "paths",
    "risks",
    "schemaVersion",
    "snippets"
  ]);
  assert.deepEqual(Object.keys(capsule.snippets[0]).sort(), ["content", "endLine", "path", "startLine"]);
});

test("buildTaskCapsule enforces dedupe and explicit constraints behavior", () => {
  const capsule = buildTaskCapsule(
    {
      goal: "Capsule constraints",
      owner: "capsule-owner",
      paths: ["src/a.ts", "src/a.ts", "src/b.ts", "src/b.ts"],
      acceptanceCriteria: ["must pass", "must pass", "  "],
      risks: ["risk-1", "risk-2", "risk-1"],
      snippets: [
        {
          selector: "src/a.ts:1:2",
          content: "123456"
        },
        {
          selector: "src/b.ts:5:8",
          content: "abcdef"
        },
        {
          selector: "src/c.ts:9:9",
          content: "zzzzzz"
        }
      ]
    },
    {
      constraints: {
        maxSnippets: 2,
        maxSnippetChars: 4
      }
    }
  );

  assert.deepEqual(capsule.paths, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(capsule.acceptanceCriteria, ["must pass"]);
  assert.deepEqual(capsule.risks, ["risk-1", "risk-2"]);
  assert.equal(capsule.snippets.length, 2);
  assert.equal(capsule.snippets[0].content, "1234");
  assert.equal(capsule.snippets[1].content, "abcd");
});

test("buildTaskCapsule rejects invalid numeric constraints", () => {
  const input = {
    goal: "Constraint validation",
    owner: "capsule-owner"
  };

  assert.throws(
    () => buildTaskCapsule(input, { constraints: { maxSnippets: -1 } }),
    /maxSnippets must be a non-negative integer\./
  );
  assert.throws(
    () => buildTaskCapsule(input, { constraints: { maxSnippetChars: Number.NaN } }),
    /maxSnippetChars must be a non-negative integer\./
  );
  assert.throws(
    () => buildTaskCapsule(input, { constraints: { selectorLineMin: 0 } }),
    /selectorLineMin must be a positive integer\./
  );
  assert.throws(
    () => buildTaskCapsule(input, { constraints: { selectorLineMax: 1.5 } }),
    /selectorLineMax must be a positive integer\./
  );
});
