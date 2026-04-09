/**
 * @file Deterministic worker-brief generator with strict file-scope validation.
 */

import type { TaskCapsule, TaskCapsuleSnippet } from "./task-capsule.js";

/**
 * Input payload for deterministic worker-brief generation.
 */
export interface BuildAgentBriefInput {
  capsule: TaskCapsule;
  ownedPaths: readonly string[];
}

/**
 * Structured worker-brief model with deterministic ordering.
 */
export interface AgentBrief {
  task: string;
  owner: string;
  ownedFiles: string[];
  acceptanceCriteria: string[];
  risks: string[];
  relevantSnippets: TaskCapsuleSnippet[];
  text: string;
}

/**
 * Validates and normalizes owned paths against capsule scope.
 *
 * Rules:
 * - each owned path must be non-empty
 * - parent traversal-like segments (`..`) are rejected
 * - duplicates are rejected after normalization
 * - each owned path must exist in `capsulePaths`
 *
 * @param capsulePaths Allowed capsule scope paths.
 * @param ownedPaths Agent-owned scope paths.
 * @returns Deterministically sorted normalized owned paths.
 */
export function validateAgentOwnedPaths(
  capsulePaths: readonly string[],
  ownedPaths: readonly string[]
): string[] {
  const normalizedCapsulePaths = normalizeCapsulePathSet(capsulePaths);

  const normalizedOwned: string[] = [];
  const seenOwned = new Set<string>();

  for (let index = 0; index < ownedPaths.length; index += 1) {
    const normalizedPath = normalizeScopedPath(ownedPaths[index], `ownedPaths[${index}]`);
    if (seenOwned.has(normalizedPath)) {
      throw new Error(`Duplicate owned path is not allowed: "${normalizedPath}".`);
    }
    if (!normalizedCapsulePaths.has(normalizedPath)) {
      throw new Error(`Owned path is outside capsule scope: "${normalizedPath}".`);
    }

    seenOwned.add(normalizedPath);
    normalizedOwned.push(normalizedPath);
  }

  if (normalizedOwned.length === 0) {
    throw new Error("At least one owned path is required.");
  }

  return normalizedOwned.sort(compareText);
}

/**
 * Builds a deterministic worker brief from a task capsule with leakage-safe snippet filtering.
 *
 * @param input Capsule and ownership scope used to construct the worker brief.
 * @returns Structured brief plus rendered deterministic brief text.
 */
export function buildAgentBrief(input: BuildAgentBriefInput): AgentBrief {
  const task = normalizeRequiredText(input.capsule.goal, "capsule.goal");
  const owner = normalizeRequiredText(input.capsule.owner, "capsule.owner");
  const ownedFiles = validateAgentOwnedPaths(input.capsule.paths, input.ownedPaths);

  const acceptanceCriteria = normalizeAndSortTextList(input.capsule.acceptanceCriteria);
  const risks = normalizeAndSortTextList(input.capsule.risks);
  const relevantSnippets = selectRelevantSnippets(input.capsule.snippets, ownedFiles);

  const brief: AgentBrief = {
    task,
    owner,
    ownedFiles,
    acceptanceCriteria,
    risks,
    relevantSnippets,
    text: ""
  };

  return {
    ...brief,
    text: renderAgentBriefText(brief)
  };
}

function renderAgentBriefText(brief: Omit<AgentBrief, "text">): string {
  const lines: string[] = [
    "Task:",
    brief.task,
    "",
    "Owner:",
    brief.owner,
    "",
    "Owned Files:",
    ...renderBulletSection(brief.ownedFiles),
    "",
    "Acceptance Criteria:",
    ...renderBulletSection(brief.acceptanceCriteria),
    "",
    "Risks:",
    ...renderBulletSection(brief.risks),
    "",
    "Relevant Snippets:",
    ...renderSnippets(brief.relevantSnippets)
  ];

  return `${lines.join("\n")}\n`;
}

function normalizeCapsulePathSet(paths: readonly string[]): Set<string> {
  const normalized = new Set<string>();

  for (let index = 0; index < paths.length; index += 1) {
    const candidate = paths[index].trim();
    if (!candidate) continue;
    normalized.add(normalizeScopedPath(candidate, `capsule.paths[${index}]`));
  }

  return normalized;
}

function normalizeScopedPath(rawPath: string, fieldName: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty path.`);
  }

  const slashNormalized = trimmed.replace(/\\+/g, "/");
  const hasUnixRoot = slashNormalized.startsWith("/");
  const driveMatch = slashNormalized.match(/^[A-Za-z]:/);
  const drivePrefix = driveMatch?.[0] ?? "";

  let remainder = slashNormalized;
  if (drivePrefix) {
    remainder = remainder.slice(drivePrefix.length);
  }
  if (hasUnixRoot) {
    remainder = remainder.replace(/^\/+/, "");
  }

  const segments = remainder.split("/");
  const normalizedSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new Error(`${fieldName} cannot contain parent traversal segments ("..").`);
    }
    normalizedSegments.push(segment);
  }

  if (normalizedSegments.length === 0) {
    throw new Error(`${fieldName} must resolve to a non-empty path.`);
  }

  const normalizedRemainder = normalizedSegments.join("/");
  if (drivePrefix) {
    return `${drivePrefix}/${normalizedRemainder}`;
  }
  if (hasUnixRoot) {
    return `/${normalizedRemainder}`;
  }

  return normalizedRemainder;
}

function normalizeRequiredText(raw: string, fieldName: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeAndSortTextList(values: readonly string[]): string[] {
  const deduped = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }

  return Array.from(deduped).sort(compareText);
}

function selectRelevantSnippets(
  snippets: readonly TaskCapsuleSnippet[],
  ownedPaths: readonly string[]
): TaskCapsuleSnippet[] {
  const inScope: TaskCapsuleSnippet[] = [];

  for (const snippet of snippets) {
    const normalizedPath = tryNormalizeScopedPath(snippet.path);
    if (!normalizedPath) continue;
    if (!isInsideOwnedScope(normalizedPath, ownedPaths)) continue;

    inScope.push({
      ...snippet,
      path: normalizedPath
    });
  }

  return inScope.sort(compareSnippetOrder);
}

function tryNormalizeScopedPath(rawPath: string): string | undefined {
  try {
    return normalizeScopedPath(rawPath, "snippet.path");
  } catch {
    return undefined;
  }
}

function isInsideOwnedScope(candidatePath: string, ownedPaths: readonly string[]): boolean {
  for (const ownedPath of ownedPaths) {
    if (candidatePath === ownedPath) return true;
    if (candidatePath.startsWith(`${ownedPath}/`)) return true;
  }

  return false;
}

function compareSnippetOrder(a: TaskCapsuleSnippet, b: TaskCapsuleSnippet): number {
  const pathOrder = compareText(a.path, b.path);
  if (pathOrder !== 0) return pathOrder;

  const startOrder = compareNumber(a.startLine ?? 0, b.startLine ?? 0);
  if (startOrder !== 0) return startOrder;

  const endOrder = compareNumber(a.endLine ?? 0, b.endLine ?? 0);
  if (endOrder !== 0) return endOrder;

  return compareText(a.content, b.content);
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function renderBulletSection(values: readonly string[]): string[] {
  if (values.length === 0) {
    return ["- none"];
  }

  return values.map((value) => `- ${value}`);
}

function renderSnippets(snippets: readonly TaskCapsuleSnippet[]): string[] {
  if (snippets.length === 0) {
    return ["- none"];
  }

  const lines: string[] = [];
  for (const snippet of snippets) {
    lines.push(`- ${formatSnippetSelector(snippet)}`);

    const snippetLines = snippet.content.split("\n");
    if (snippetLines.length === 1 && snippetLines[0] === "") {
      lines.push("  (empty snippet)");
      continue;
    }

    for (const line of snippetLines) {
      lines.push(`  ${line}`);
    }
  }

  return lines;
}

function formatSnippetSelector(snippet: TaskCapsuleSnippet): string {
  if (snippet.startLine === undefined) {
    return snippet.path;
  }
  if (snippet.endLine === undefined) {
    return `${snippet.path}:${snippet.startLine}`;
  }

  return `${snippet.path}:${snippet.startLine}:${snippet.endLine}`;
}
