/**
 * @file Tests for deterministic worker-brief generation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentBrief,
  validateAgentOwnedPaths
} from "./agent-brief.js";
import {
  TASK_CAPSULE_SCHEMA_VERSION,
  type TaskCapsule
} from "./task-capsule.js";

function createCapsule(overrides: Partial<TaskCapsule> = {}): TaskCapsule {
  return {
    schemaVersion: TASK_CAPSULE_SCHEMA_VERSION,
    goal: "Ship deterministic worker brief",
    owner: "orchestration-core",
    paths: ["src/orchestration", "src/utils/format.ts", "src/server"],
    acceptanceCriteria: ["include only owned snippets", "brief is deterministic"],
    risks: ["missing ownership validation", "accidental leakage"],
    snippets: [],
    ...overrides
  };
}

test("buildAgentBrief renders deterministic text and filters snippets to owned scope", () => {
  const capsule = createCapsule({
    snippets: [
      {
        path: "src/orchestration/agent-brief.ts",
        startLine: 12,
        endLine: 18,
        content: "later block"
      },
      {
        path: "src/server/bridge-server.ts",
        startLine: 2,
        endLine: 6,
        content: "must not leak"
      },
      {
        path: "src/orchestration/agent-brief.ts",
        startLine: 2,
        endLine: 4,
        content: "early block"
      },
      {
        path: "src/utils/format.ts",
        startLine: 1,
        endLine: 1,
        content: "export const fmt = () => \"ok\";"
      },
      {
        path: "src/orchestration-other/file.ts",
        startLine: 1,
        endLine: 1,
        content: "sibling path should stay out"
      },
      {
        path: "../secrets/.env",
        startLine: 1,
        endLine: 1,
        content: "invalid path should be ignored"
      }
    ]
  });

  const brief = buildAgentBrief({
    capsule,
    ownedPaths: [" src/utils/format.ts ", "src/orchestration"]
  });

  assert.deepEqual(brief.ownedFiles, ["src/orchestration", "src/utils/format.ts"]);
  assert.deepEqual(brief.acceptanceCriteria, ["brief is deterministic", "include only owned snippets"]);
  assert.deepEqual(brief.risks, ["accidental leakage", "missing ownership validation"]);

  assert.deepEqual(
    brief.relevantSnippets.map((snippet) => ({ path: snippet.path, start: snippet.startLine, end: snippet.endLine })),
    [
      { path: "src/orchestration/agent-brief.ts", start: 2, end: 4 },
      { path: "src/orchestration/agent-brief.ts", start: 12, end: 18 },
      { path: "src/utils/format.ts", start: 1, end: 1 }
    ]
  );

  assert.equal(
    brief.text,
    [
      "Task:",
      "Ship deterministic worker brief",
      "",
      "Owner:",
      "orchestration-core",
      "",
      "Owned Files:",
      "- src/orchestration",
      "- src/utils/format.ts",
      "",
      "Acceptance Criteria:",
      "- brief is deterministic",
      "- include only owned snippets",
      "",
      "Risks:",
      "- accidental leakage",
      "- missing ownership validation",
      "",
      "Relevant Snippets:",
      "- src/orchestration/agent-brief.ts:2:4",
      "  early block",
      "- src/orchestration/agent-brief.ts:12:18",
      "  later block",
      "- src/utils/format.ts:1:1",
      "  export const fmt = () => \"ok\";",
      ""
    ].join("\n")
  );
});

test("validateAgentOwnedPaths enforces non-empty owned paths", () => {
  assert.throws(
    () => validateAgentOwnedPaths(["src/orchestration"], ["   "]),
    /ownedPaths\[0\] must be a non-empty path\./
  );
});

test("validateAgentOwnedPaths rejects duplicates after normalization", () => {
  assert.throws(
    () => validateAgentOwnedPaths(["src/a.ts"], ["src/a.ts", "./src/a.ts"]),
    /Duplicate owned path is not allowed: "src\/a\.ts"\./
  );
});

test("validateAgentOwnedPaths rejects parent traversal-like segments", () => {
  assert.throws(
    () => validateAgentOwnedPaths(["src/a.ts"], ["src/../a.ts"]),
    /ownedPaths\[0\] cannot contain parent traversal segments \("\.\."\)\./
  );
});

test("validateAgentOwnedPaths requires every owned path to exist in capsule scope", () => {
  assert.throws(
    () => validateAgentOwnedPaths(["src/a.ts"], ["src/b.ts"]),
    /Owned path is outside capsule scope: "src\/b\.ts"\./
  );
});

test("validateAgentOwnedPaths requires at least one owned path", () => {
  assert.throws(
    () => validateAgentOwnedPaths(["src/a.ts"], []),
    /At least one owned path is required\./
  );
});

test("validateAgentOwnedPaths normalizes slash style and sorts deterministically", () => {
  const ownedPaths = validateAgentOwnedPaths(
    ["src/b.ts", "src/a.ts"],
    ["src\\b.ts", " src/a.ts "]
  );

  assert.deepEqual(ownedPaths, ["src/a.ts", "src/b.ts"]);
});

test("buildAgentBrief omits snippets that are outside owned directory boundary", () => {
  const brief = buildAgentBrief({
    capsule: createCapsule({
      paths: ["src/features"],
      snippets: [
        {
          path: "src/features/ok.ts",
          content: "in scope"
        },
        {
          path: "src/features-other/out.ts",
          content: "must be excluded"
        }
      ]
    }),
    ownedPaths: ["src/features"]
  });

  assert.deepEqual(
    brief.relevantSnippets.map((snippet) => snippet.path),
    ["src/features/ok.ts"]
  );
});
