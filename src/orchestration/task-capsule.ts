/**
 * @file Distilled task capsule builder with leakage-minimizing defaults.
 */

/**
 * Stable schema identifier for generated task capsules.
 */
export const TASK_CAPSULE_SCHEMA_VERSION = "task-capsule.v1" as const;

const DEFAULT_SELECTOR_LINE_MIN = 1;
const DEFAULT_SELECTOR_LINE_MAX = 200000;

/**
 * Default hard limits used to reduce accidental data leakage.
 */
export const DEFAULT_TASK_CAPSULE_CONSTRAINTS = {
  maxSnippets: 8,
  maxSnippetChars: 1200,
  selectorLineMin: DEFAULT_SELECTOR_LINE_MIN,
  selectorLineMax: DEFAULT_SELECTOR_LINE_MAX
} as const;

/**
 * Parsed file snippet selector in `path[:start[:end]]` form.
 */
export interface FileSnippetSelector {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Raw snippet input consumed by the capsule builder.
 */
export interface TaskCapsuleSnippetInput {
  selector: string;
  content: string;
}

/**
 * Normalized snippet shape emitted inside the task capsule.
 */
export interface TaskCapsuleSnippet {
  path: string;
  startLine?: number;
  endLine?: number;
  content: string;
}

/**
 * Capsule builder input model.
 */
export interface TaskCapsuleInput {
  goal: string;
  owner: string;
  paths?: readonly string[];
  acceptanceCriteria?: readonly string[];
  risks?: readonly string[];
  snippets?: readonly TaskCapsuleSnippetInput[];
}

/**
 * Leak-minimization limits for capsule generation.
 */
export interface TaskCapsuleConstraints {
  maxSnippets: number;
  maxSnippetChars: number;
  selectorLineMin: number;
  selectorLineMax: number;
}

/**
 * Optional configuration accepted by the capsule builder.
 */
export interface BuildTaskCapsuleOptions {
  constraints?: Partial<TaskCapsuleConstraints>;
}

/**
 * Final task capsule schema.
 */
export interface TaskCapsule {
  schemaVersion: typeof TASK_CAPSULE_SCHEMA_VERSION;
  goal: string;
  owner: string;
  paths: string[];
  acceptanceCriteria: string[];
  risks: string[];
  snippets: TaskCapsuleSnippet[];
}

interface ParseSelectorOptions {
  lineMin?: number;
  lineMax?: number;
}

/**
 * Parses a snippet selector formatted as `path[:start[:end]]`.
 * Numeric line bounds are clamped to a safe inclusive range.
 *
 * @param rawSelector Selector string to parse.
 * @param options Optional line clamp settings.
 * @returns Parsed selector with normalized line bounds.
 */
export function parseFileSnippetSelector(
  rawSelector: string,
  options: ParseSelectorOptions = {}
): FileSnippetSelector {
  const selector = rawSelector.trim();
  if (!selector) {
    throw new Error("Snippet selector must be a non-empty string.");
  }

  const lineMin = normalizePositiveInteger(
    options.lineMin ?? DEFAULT_SELECTOR_LINE_MIN,
    "lineMin"
  );
  const lineMax = normalizePositiveInteger(
    options.lineMax ?? DEFAULT_SELECTOR_LINE_MAX,
    "lineMax"
  );
  if (lineMin > lineMax) {
    throw new Error("Invalid selector bounds: lineMin cannot exceed lineMax.");
  }

  const rangedMatch = selector.match(/^(.*):(-?\d+):(-?\d+)$/);
  if (rangedMatch) {
    const parsed = parsePathAndRange(rangedMatch[1], rangedMatch[2], rangedMatch[3], lineMin, lineMax);
    return parsed;
  }

  const startOnlyMatch = selector.match(/^(.*):(-?\d+)$/);
  if (startOnlyMatch) {
    const parsed = parsePathAndRange(startOnlyMatch[1], startOnlyMatch[2], undefined, lineMin, lineMax);
    return parsed;
  }

  const path = selector.trim();
  if (!path) {
    throw new Error(`Invalid snippet selector "${rawSelector}".`);
  }
  return { path };
}

/**
 * Builds a strongly-typed task capsule using constrained, leakage-minimizing defaults.
 *
 * @param input Raw capsule inputs.
 * @param options Optional constraint overrides.
 * @returns Sanitized capsule containing only allowed fields.
 */
export function buildTaskCapsule(
  input: TaskCapsuleInput,
  options: BuildTaskCapsuleOptions = {}
): TaskCapsule {
  const constraints = resolveConstraints(options.constraints);
  const goal = normalizeRequiredText(input.goal, "goal");
  const owner = normalizeRequiredText(input.owner, "owner");

  const pathSet = new Set<string>();
  const addPath = (candidate: string): void => {
    const normalized = candidate.trim();
    if (!normalized) return;
    pathSet.add(normalized);
  };

  for (const candidate of input.paths ?? []) {
    addPath(candidate);
  }

  const snippets: TaskCapsuleSnippet[] = [];
  for (const snippetInput of input.snippets ?? []) {
    if (snippets.length >= constraints.maxSnippets) break;

    const selector = parseFileSnippetSelector(snippetInput.selector, {
      lineMin: constraints.selectorLineMin,
      lineMax: constraints.selectorLineMax
    });
    const content = truncateText(snippetInput.content, constraints.maxSnippetChars);

    addPath(selector.path);

    snippets.push({
      path: selector.path,
      ...(selector.startLine !== undefined ? { startLine: selector.startLine } : {}),
      ...(selector.endLine !== undefined ? { endLine: selector.endLine } : {}),
      content
    });
  }

  return {
    schemaVersion: TASK_CAPSULE_SCHEMA_VERSION,
    goal,
    owner,
    paths: Array.from(pathSet),
    acceptanceCriteria: normalizeStringList(input.acceptanceCriteria),
    risks: normalizeStringList(input.risks),
    snippets
  };
}

function parsePathAndRange(
  rawPath: string,
  rawStart: string,
  rawEnd: string | undefined,
  lineMin: number,
  lineMax: number
): FileSnippetSelector {
  const path = rawPath.trim();
  if (!path) {
    throw new Error("Snippet selector path must be non-empty.");
  }

  const startLine = clampLine(Number.parseInt(rawStart, 10), lineMin, lineMax);
  if (rawEnd === undefined) {
    return { path, startLine };
  }

  const endCandidate = clampLine(Number.parseInt(rawEnd, 10), lineMin, lineMax);
  const endLine = Math.max(startLine, endCandidate);
  return { path, startLine, endLine };
}

function resolveConstraints(
  overrides: Partial<TaskCapsuleConstraints> | undefined
): TaskCapsuleConstraints {
  const merged: TaskCapsuleConstraints = {
    maxSnippets: normalizeNonNegativeInteger(
      overrides?.maxSnippets ?? DEFAULT_TASK_CAPSULE_CONSTRAINTS.maxSnippets,
      "maxSnippets"
    ),
    maxSnippetChars: normalizeNonNegativeInteger(
      overrides?.maxSnippetChars ?? DEFAULT_TASK_CAPSULE_CONSTRAINTS.maxSnippetChars,
      "maxSnippetChars"
    ),
    selectorLineMin:
      normalizePositiveInteger(
        overrides?.selectorLineMin ?? DEFAULT_TASK_CAPSULE_CONSTRAINTS.selectorLineMin,
        "selectorLineMin"
      ),
    selectorLineMax: normalizePositiveInteger(
      overrides?.selectorLineMax ?? DEFAULT_TASK_CAPSULE_CONSTRAINTS.selectorLineMax,
      "selectorLineMax"
    )
  };

  if (merged.selectorLineMin > merged.selectorLineMax) {
    throw new Error("selectorLineMin cannot exceed selectorLineMax.");
  }

  return merged;
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function clampLine(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeRequiredText(raw: string, fieldName: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    throw new Error(`Task capsule ${fieldName} is required.`);
  }
  return normalized;
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  const deduped = new Set<string>();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

function truncateText(raw: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars);
}
