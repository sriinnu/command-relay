#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type QaSectionName = "deps" | "ci" | "release" | "relay" | "smoke";

interface QaModeOptions {
  selectedSections?: readonly string[];
  skipInstall?: boolean;
  artifactPath?: string;
}

type QaStatus = "pending" | "running" | "pass" | "fail";

interface QaSectionState {
  name: QaSectionName;
  label: string;
  status: QaStatus;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
}

interface RunnerInvocation {
  command: string;
  args: string[];
  sectionArg: string;
  skipInstallArg: string;
}

const SECTION_ORDER: QaSectionName[] = ["deps", "ci", "release", "relay", "smoke"];
const SECTION_LABELS: Readonly<Record<QaSectionName, string>> = {
  deps: "Dependencies + package smoke checks",
  ci: "CI gates",
  release: "Release guardrails",
  relay: "Relay runtime + status checks",
  smoke: "Package-by-package smoke checks"
};

const STATUS_ICON: Readonly<Record<QaStatus, string>> = {
  pending: "[ ]",
  running: "[…]",
  pass: "[✔]",
  fail: "[✖]"
};

interface QaRunArtifactSection {
  name: QaSectionName;
  label: string;
  status: QaStatus;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
}

interface QaRunArtifact {
  startedAt: number;
  finishedAt: number | null;
  selectedSections: QaSectionName[];
  overallPassed: boolean | null;
  sections: QaRunArtifactSection[];
  repositoryRoot: string;
}

const CLI_FILE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = locateRepoRoot(CLI_FILE_PATH);
const RUNNER_ROOT = path.join(REPO_ROOT, "scripts", "ops");
const BASH_RUNNER = path.join(RUNNER_ROOT, "run-production-qa.sh");
const PS1_RUNNER = path.join(RUNNER_ROOT, "run-production-qa.ps1");

/**
 * Launch the interactive production QA runner with check-style output.
 * Returns true when all selected sections pass.
 */
export async function runProductionQaMode(options: QaModeOptions = {}): Promise<boolean> {
  const selected = resolveSelectedSections(options.selectedSections);
  const runner = resolveRunnerInvocation();
  const sections: QaSectionState[] = selected.map((name) => ({
    name,
    label: SECTION_LABELS[name],
    status: "pending",
    startedAt: null,
    finishedAt: null,
    exitCode: null
  }));
  const startedAt = Date.now();
  let allPassed = true;

  const emitArtifact = (final = false): void => {
    if (!options.artifactPath) {
      return;
    }
    writeRunArtifact(options.artifactPath, {
      startedAt,
      finishedAt: final ? Date.now() : null,
      selectedSections: selected,
      overallPassed: final ? allPassed : null,
      sections: sections.map((section) => ({
        name: section.name,
        label: section.label,
        status: section.status,
        startedAt: section.startedAt,
        finishedAt: section.finishedAt,
        exitCode: section.exitCode
      })),
      repositoryRoot: REPO_ROOT
    });
  };

  printIntro();
  renderChecklist(sections);
  emitArtifact();

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const shouldSkipInstall = options.skipInstall === true || index > 0;
    section.status = "running";
    section.startedAt = Date.now();
    renderChecklist(sections);
    emitArtifact();

    const result = await runSection(runner, section.name, shouldSkipInstall);
    section.finishedAt = Date.now();
    section.exitCode = result.exitCode;
    section.status = result.passed ? "pass" : "fail";
    emitArtifact();
    allPassed = allPassed && result.passed;
    renderChecklist(sections);
  }

  printFinalSummary(allPassed, sections);
  emitArtifact(true);
  return allPassed;
}

function writeRunArtifact(artifactPath: string, report: QaRunArtifact): void {
  const output: QaRunArtifact = { ...report };
  if (typeof output.overallPassed !== "boolean") {
    output.overallPassed = null;
  }
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(output, null, 2)}\n`, {
    encoding: "utf8"
  });
}

/**
 * Build the arguments that will be passed to the runner for a specific section.
 */
export function buildSectionInvocation(
  runner: RunnerInvocation,
  section: QaSectionName,
  skipInstall: boolean
): string[] {
  const args = [...runner.args];
  args.push(runner.sectionArg, section);
  if (skipInstall) {
    args.push(runner.skipInstallArg);
  }
  return args;
}

/**
 * Public for CLI-facing testing and consistency checks.
 */
export function resolveSelectedSectionsFromCliArg(raw: readonly string[] | undefined): QaSectionName[] {
  return resolveSelectedSections(raw);
}

function resolveSelectedSections(raw: readonly string[] | undefined): QaSectionName[] {
  if (!raw || raw.length === 0) {
    return SECTION_ORDER;
  }
  const selected = parseSections(raw.join(","));
  if (selected.length === 0) {
    return SECTION_ORDER;
  }
  return selected;
}

/**
 * Public for CLI-facing testing and consistency checks.
 */
export function normalizeSections(raw: string): QaSectionName[] {
  return parseSections(raw);
}

function parseSections(raw: string): QaSectionName[] {
  if (!raw.trim()) {
    return [];
  }
  const deduped: QaSectionName[] = [];
  const tokens = raw
    .split(/[, ]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  for (const token of tokens) {
    if (token === "all") {
      return SECTION_ORDER;
    }

    const mapped = tokenToSection(token);
    if (!mapped) {
      throw new Error(`Unknown section: ${token}. Use deps, ci, release, relay, smoke, all.`);
    }
    if (!deduped.includes(mapped)) {
      deduped.push(mapped);
    }
  }
  return deduped;
}

function tokenToSection(token: string): QaSectionName | null {
  if (token.match(/^\d+$/)) {
    const index = Number.parseInt(token, 10);
    if (index >= 1 && index <= SECTION_ORDER.length) {
      return SECTION_ORDER[index - 1];
    }
    return null;
  }

  switch (token) {
    case "deps":
    case "dependencies":
      return "deps";
    case "ci":
      return "ci";
    case "release":
      return "release";
    case "relay":
      return "relay";
    case "smoke":
      return "smoke";
    default:
      return null;
  }
}

function resolveRunnerInvocation(): RunnerInvocation {
  if (!pathExists(BASH_RUNNER) || !pathExists(PS1_RUNNER)) {
    throw new Error("Production QA runner scripts are missing from scripts/ops.");
  }

  if (process.platform === "win32") {
    const command = commandExists("pwsh")
      ? "pwsh"
      : commandExists("powershell")
        ? "powershell"
        : null;
    if (!command) {
      throw new Error("No supported PowerShell executable found; install PowerShell 7+.");
    }

    return {
      command,
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        PS1_RUNNER
      ],
      sectionArg: "-Section",
      skipInstallArg: "-SkipInstall"
    };
  }

  return {
    command: "bash",
    args: [BASH_RUNNER],
    sectionArg: "--section",
    skipInstallArg: "--skip-install"
  };
}

function locateRepoRoot(start: string): string {
  let current = path.resolve(start);
  for (let guard = 0; guard < 12; guard += 1) {
    if (pathExists(path.join(current, "scripts", "ops", "run-production-qa.sh"))) {
      return current;
    }
    const parent = path.resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("Cannot locate repository root for run-production-qa scripts.");
}

function pathExists(candidate: string): boolean {
  try {
    accessSync(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(name: string): boolean {
  const command = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [name] : ["-v", name];
  const probe = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "ignore",
    shell: process.platform === "win32"
  });
  return probe.status === 0;
}

async function runSection(
  runner: RunnerInvocation,
  section: QaSectionName,
  skipInstall: boolean
): Promise<{ passed: boolean; exitCode: number | null }> {
  const args = buildSectionInvocation(runner, section, skipInstall);

  return new Promise<{ passed: boolean; exitCode: number | null }>((resolve) => {
    const child = spawn(runner.command, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: false
    });

    child.on("error", () => {
      resolve({ passed: false, exitCode: null });
    });
    child.on("close", (code) => {
      resolve({ passed: code === 0, exitCode: code });
    });
  });
}

function printIntro(): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("CommandRelay Production QA\n");
  process.stdout.write("========================\n\n");
  process.stdout.write("Sections use check-off status while they run:\n");
}

function renderChecklist(sections: readonly QaSectionState[]): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("CommandRelay Production QA\n");
  process.stdout.write("========================\n\n");
  for (const section of sections) {
    process.stdout.write(`${STATUS_ICON[section.status]} ${section.name}  ${section.label}\n`);
  }
  process.stdout.write("\nRun in progress... keep this window open.\n");
}

function printFinalSummary(passedAll: boolean, sections: readonly QaSectionState[]): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("Production QA complete\n");
  process.stdout.write("===================\n\n");
  for (const section of sections) {
    process.stdout.write(`${STATUS_ICON[section.status]} ${section.name}\n`);
  }
  process.stdout.write("\n");
  if (passedAll) {
    process.stdout.write("Result: PASS\n");
    process.stdout.write("All selected sections passed.\n");
  } else {
    process.stdout.write("Result: FAIL\n");
    process.stdout.write("Review the section output for failure details.\n");
  }
}

/**
 * Returns usage docs for the QA-mode flags in CLI help output.
 */
export function createQaModeUsage(): string {
  return [
    "--qa",
    "--qa-sections <deps,ci,release,relay,smoke|all|1,2,3..>",
    "--qa-skip-install",
    "--qa-artifact <path>"
  ].join("\n");
}
