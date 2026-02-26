/**
 * @file Deterministic spawn-agent dispatch template builder.
 */

const SECTION_HEADING_PATTERN = /^[A-Za-z][A-Za-z0-9 _/-]*:\s*$/;
const TASK_HEADING_PATTERN = /^\s*Task:\s*(.*)$/i;

/**
 * Stable safety notice included in every dispatch payload.
 */
export const DISPATCH_SAFETY_NOTICE =
  "You are NOT alone in the codebase; ignore edits by others unless overlapping your owned files." as const;

/**
 * Input used to render a deterministic dispatch message.
 */
export interface BuildAgentDispatchMessageInput {
  task?: string;
  owner: string;
  ownedPaths: readonly string[];
  briefBody: string;
  instructions?: readonly string[];
}

/**
 * Input payload used to construct a spawn-agent template object.
 */
export interface BuildSpawnAgentTemplateInput extends BuildAgentDispatchMessageInput {
  agentType: string;
}

/**
 * Metadata attached to the final spawn-agent template object.
 */
export interface SpawnAgentTemplateMetadata {
  task: string;
  owner: string;
  owned_files: string[];
  additional_instructions: string[];
  safety_notice: string;
  brief_body: string;
}

/**
 * Deterministic spawn-agent template shape.
 */
export interface SpawnAgentTemplate {
  agent_type: string;
  message: string;
  metadata: SpawnAgentTemplateMetadata;
}

/**
 * Parses a task statement from a brief body section headed by `Task:`.
 * Supports both inline (`Task: Do X`) and block forms:
 *
 * `Task:`
 * `Do X`
 *
 * @param briefBody Brief body text that should contain a `Task:` section.
 * @returns Parsed task text.
 */
export function parseTaskFromBrief(briefBody: string): string {
  const normalizedBody = normalizeMultilineText(briefBody, "briefBody");
  const lines = normalizedBody.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const taskMatch = lines[index].match(TASK_HEADING_PATTERN);
    if (!taskMatch) continue;

    const collectedLines: string[] = [];
    const inlineTask = taskMatch[1].trim();
    if (inlineTask) {
      collectedLines.push(inlineTask);
    }

    for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (isSectionBoundary(line)) {
        break;
      }
      collectedLines.push(line);
    }

    const task = collectedLines.join("\n").trim();
    if (!task) {
      throw new Error("Task section is present but empty.");
    }
    return task;
  }

  throw new Error(
    'Task is required. Provide `task` explicitly or include a "Task:" section in `briefBody`.'
  );
}

/**
 * Validates and normalizes owned paths with deterministic output ordering.
 *
 * Validation rules:
 * - must contain at least one path
 * - each raw path must be non-empty after trimming
 * - parent traversal segments (`..`) are rejected
 * - slash style is normalized to `/`
 * - normalized duplicates are removed
 *
 * @param ownedPaths Raw owned paths to normalize.
 * @returns Deduplicated, normalized, and sorted paths.
 */
export function validateOwnedPaths(ownedPaths: readonly string[]): string[] {
  if (ownedPaths.length === 0) {
    throw new Error("At least one owned path is required.");
  }

  const normalizedSet = new Set<string>();
  for (let index = 0; index < ownedPaths.length; index += 1) {
    normalizedSet.add(normalizeOwnedPath(ownedPaths[index], `ownedPaths[${index}]`));
  }

  const normalized = Array.from(normalizedSet).sort(compareText);
  if (normalized.length === 0) {
    throw new Error("At least one owned path is required.");
  }

  return normalized;
}

/**
 * Builds a deterministic dispatch message for `spawn_agent`.
 * If `task` is omitted, it is parsed from the brief body `Task:` section.
 *
 * @param input Dispatch message input model.
 * @returns Message text that includes task, owner, owned files, safety notice, and brief body.
 */
export function buildAgentDispatchMessage(input: BuildAgentDispatchMessageInput): string {
  const owner = normalizeRequiredText(input.owner, "owner");
  const briefBody = normalizeMultilineText(input.briefBody, "briefBody");
  const ownedFiles = validateOwnedPaths(input.ownedPaths);
  const additionalInstructions = normalizeInstructionList(input.instructions);
  const task = input.task
    ? normalizeMultilineText(input.task, "task")
    : parseTaskFromBrief(briefBody);

  return renderDispatchMessage({
    task,
    owner,
    ownedFiles,
    additionalInstructions,
    briefBody
  });
}

/**
 * Builds a deterministic JSON template object that can be passed directly to `spawn_agent`.
 * The generated payload always contains `agent_type`, `message`, and `metadata`.
 *
 * @param input Spawn-agent template input model.
 * @returns Deterministic template payload for `spawn_agent`.
 */
export function buildSpawnAgentTemplate(input: BuildSpawnAgentTemplateInput): SpawnAgentTemplate {
  const agentType = normalizeRequiredText(input.agentType, "agentType");
  const owner = normalizeRequiredText(input.owner, "owner");
  const briefBody = normalizeMultilineText(input.briefBody, "briefBody");
  const ownedFiles = validateOwnedPaths(input.ownedPaths);
  const additionalInstructions = normalizeInstructionList(input.instructions);
  const task = input.task
    ? normalizeMultilineText(input.task, "task")
    : parseTaskFromBrief(briefBody);
  const message = renderDispatchMessage({
    task,
    owner,
    ownedFiles,
    additionalInstructions,
    briefBody
  });

  return {
    agent_type: agentType,
    message,
    metadata: {
      task,
      owner,
      owned_files: ownedFiles,
      additional_instructions: additionalInstructions,
      safety_notice: DISPATCH_SAFETY_NOTICE,
      brief_body: briefBody
    }
  };
}

interface RenderDispatchMessageInput {
  task: string;
  owner: string;
  ownedFiles: readonly string[];
  additionalInstructions: readonly string[];
  briefBody: string;
}

function renderDispatchMessage(input: RenderDispatchMessageInput): string {
  const lines: string[] = [
    "Task:",
    input.task,
    "",
    "Owner:",
    input.owner,
    "",
    "Owned Files:",
    ...input.ownedFiles.map((ownedPath) => `- ${ownedPath}`),
    "",
    "Additional Instructions:",
    ...renderBulletSection(input.additionalInstructions),
    "",
    "Safety Notice:",
    DISPATCH_SAFETY_NOTICE,
    "",
    "Brief Body:",
    input.briefBody
  ];

  return `${lines.join("\n")}\n`;
}

function isSectionBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!SECTION_HEADING_PATTERN.test(trimmed)) return false;
  return !/^Task:\s*$/i.test(trimmed);
}

function normalizeOwnedPath(rawPath: string, fieldName: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty path.`);
  }

  const slashNormalized = trimmed.replace(/\\+/g, "/");
  const hasUnixRoot = slashNormalized.startsWith("/");
  const drivePrefixMatch = slashNormalized.match(/^[A-Za-z]:/);
  const drivePrefix = drivePrefixMatch?.[0] ?? "";

  let remainder = slashNormalized;
  if (drivePrefix) {
    remainder = remainder.slice(drivePrefix.length);
  }
  if (hasUnixRoot) {
    remainder = remainder.replace(/^\/+/, "");
  }

  const normalizedSegments: string[] = [];
  for (const segment of remainder.split("/")) {
    if (!segment || segment === ".") continue;
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

function normalizeMultilineText(raw: string, fieldName: string): string {
  const normalized = normalizeRequiredText(raw, fieldName).replace(/\r\n/g, "\n");
  return normalized.trim();
}

function normalizeInstructionList(rawInstructions: readonly string[] | undefined): string[] {
  const normalized = new Set<string>();
  for (const raw of rawInstructions ?? []) {
    const value = raw.trim();
    if (!value) continue;
    normalized.add(value);
  }
  return Array.from(normalized).sort(compareText);
}

function renderBulletSection(values: readonly string[]): string[] {
  if (values.length === 0) {
    return ["- none"];
  }

  return values.map((value) => `- ${value}`);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
