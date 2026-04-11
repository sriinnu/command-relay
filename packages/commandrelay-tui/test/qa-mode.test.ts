import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSectionInvocation,
  normalizeSections,
  resolveSelectedSectionsFromCliArg
} from "../src/qa-mode.js";

test("resolveSelectedSectionsFromCliArg returns all sections when empty", () => {
  assert.deepEqual(resolveSelectedSectionsFromCliArg(undefined), ["deps", "ci", "release", "relay", "smoke"]);
  assert.deepEqual(resolveSelectedSectionsFromCliArg([]), ["deps", "ci", "release", "relay", "smoke"]);
});

test("resolveSelectedSectionsFromCliArg parses names, numbers, and deduplicates", () => {
  const sections = resolveSelectedSectionsFromCliArg(["deps,ci", "smoke", "1", "3", "smoke"]);
  assert.deepEqual(sections, ["deps", "ci", "smoke", "release"]);
});

test("normalizeSections throws on unknown section name", () => {
  assert.throws(() => {
    normalizeSections("deps,bad-section");
  }, /Unknown section: bad-section/);
});

test("buildSectionInvocation builds bash section calls", () => {
  const invocation = buildSectionInvocation(
    {
      command: "bash",
      args: ["scripts/ops/run-production-qa.sh"],
      sectionArg: "--section",
      skipInstallArg: "--skip-install"
    },
    "ci",
    true
  );
  assert.deepEqual(invocation, ["scripts/ops/run-production-qa.sh", "--section", "ci", "--skip-install"]);
});

test("buildSectionInvocation excludes skip flag when not requested", () => {
  const invocation = buildSectionInvocation(
    {
      command: "pwsh",
      args: ["-NoProfile", "-File", "scripts/ops/run-production-qa.ps1"],
      sectionArg: "-Section",
      skipInstallArg: "-SkipInstall"
    },
    "release",
    false
  );
  assert.deepEqual(invocation, ["-NoProfile", "-File", "scripts/ops/run-production-qa.ps1", "-Section", "release"]);
});
