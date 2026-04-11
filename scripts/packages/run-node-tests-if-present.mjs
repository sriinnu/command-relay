#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Recursively collects compiled Node test files.
 *
 * @param {string} directory Directory to scan.
 * @returns {string[]} Sorted test file paths.
 */
function collectTestFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const testFiles = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      testFiles.push(...collectTestFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      testFiles.push(entryPath);
    }
  }

  return testFiles.sort();
}

const testRoot = process.argv[2] ?? "dist";
const testFiles = collectTestFiles(testRoot);

if (testFiles.length === 0) {
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
