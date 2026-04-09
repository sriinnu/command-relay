/**
 * Persistent connection profile storage for commandrelay-tui.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import os from "node:os";
import process from "node:process";
import type { Backend } from "./backend.js";

interface StoredProfiles {
  version: 1;
  activeProfileName: string | null;
  profiles: Record<string, ConnectionProfile>;
}

/** Profile data persisted to local commandrelay configuration. */
export interface ConnectionProfile {
  name: string;
  url: string;
  backend?: Backend;
  authToken?: string | null;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

/** Runtime state resolved from persistent profiles and CLI overrides. */
export interface ActiveProfileState {
  activeProfileName: string | null;
  selectedProfile: ConnectionProfile | null;
  hasProfileStore: boolean;
}

const PROFILE_DIR_ENV = "COMMANDRELAY_PROFILE_DIR";
const PROFILE_FILE_NAME = "profiles.json";
const PROFILE_FILE_VERSION = 1;
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Resolves absolute profile directory path.
 */
export function resolveProfileDirectory(): string {
  const configured = process.env[PROFILE_DIR_ENV]?.trim();
  if (configured) return resolve(configured);
  return join(os.homedir(), ".commandrelay");
}

/**
 * Resolves absolute profile file path.
 */
export function resolveProfileFilePath(): string {
  return join(resolveProfileDirectory(), PROFILE_FILE_NAME);
}

/**
 * Validates user-facing profile names.
 */
export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_PATTERN.test(name.trim());
}

/**
 * Returns true when URL is likely usable as a CommandRelay endpoint.
 */
export function isValidProfileUrl(url: string): boolean {
  try {
    const normalized = new URL(url);
    return normalized.protocol === "ws:" || normalized.protocol === "wss:";
  } catch {
    return false;
  }
}

/**
 * Loads saved profile store, creating defaults when file is missing.
 */
export function loadProfiles(): StoredProfiles {
  const filePath = resolveProfileFilePath();
  if (!existsSync(filePath)) {
    return {
      version: PROFILE_FILE_VERSION,
      activeProfileName: null,
      profiles: {}
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) throw new Error("empty profile file");
    const parsed = JSON.parse(raw);
    return normalizeProfileStore(parsed);
  } catch {
    return {
      version: PROFILE_FILE_VERSION,
      activeProfileName: null,
      profiles: {}
    };
  }
}

/**
 * Persists profile store to disk.
 */
export function saveProfiles(store: StoredProfiles): void {
  const filePath = resolveProfileFilePath();
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2));
}

/**
 * Reads profile lookup state with optional override selection.
 *
 * @param preferredProfileName Explicit profile chosen by CLI.
 */
export function resolveProfileSelection(preferredProfileName: string | null): ActiveProfileState {
  const store = loadProfiles();
  if (preferredProfileName && store.profiles[preferredProfileName]) {
    return {
      activeProfileName: preferredProfileName,
      selectedProfile: store.profiles[preferredProfileName],
      hasProfileStore: true
    };
  }
  const activeName = store.activeProfileName;
  if (activeName && store.profiles[activeName]) {
    return {
      activeProfileName: activeName,
      selectedProfile: store.profiles[activeName],
      hasProfileStore: true
    };
  }
  return {
    activeProfileName: null,
    selectedProfile: null,
    hasProfileStore: Object.keys(store.profiles).length > 0
  };
}

/**
 * Adds or updates a profile entry.
 */
export function upsertProfile(
  profile: Pick<ConnectionProfile, "name" | "url"> & Partial<Pick<ConnectionProfile, "backend" | "authToken" | "notes">>
): void {
  const normalized = normalizeProfileCandidate(profile);
  if (!normalized) {
    return;
  }
  const store = loadProfiles();
  const now = Date.now();
  const existing = store.profiles[normalized.name];
  store.profiles[normalized.name] = {
    ...existing,
    ...normalized,
    name: normalized.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  if (!store.activeProfileName) {
    store.activeProfileName = normalized.name;
  }
  saveProfiles(store);
}

/**
 * Removes a profile by name.
 */
export function removeProfile(name: string): void {
  const store = loadProfiles();
  delete store.profiles[name];
  if (store.activeProfileName === name) {
    const remaining = Object.keys(store.profiles);
    store.activeProfileName = remaining.length > 0 ? remaining[0] : null;
  }
  saveProfiles(store);
}

/**
 * Persists active profile selection.
 */
export function setActiveProfile(name: string | null): void {
  const store = loadProfiles();
  store.activeProfileName = store.profiles[name ?? ""] ? name : null;
  saveProfiles(store);
}

/**
 * Updates token on existing profile.
 */
export function setProfileToken(name: string, token: string | null): void {
  const store = loadProfiles();
  const profile = store.profiles[name];
  if (!profile) return;
  profile.authToken = token;
  profile.updatedAt = Date.now();
  store.profiles[name] = profile;
  saveProfiles(store);
}

/**
 * Marks profile as recently used.
 */
export function touchProfile(name: string): void {
  const store = loadProfiles();
  const profile = store.profiles[name];
  if (!profile) return;
  profile.lastUsedAt = Date.now();
  profile.updatedAt = Date.now();
  store.profiles[name] = profile;
  saveProfiles(store);
}

function normalizeProfileStore(candidate: unknown): StoredProfiles {
  const fallback: StoredProfiles = {
    version: PROFILE_FILE_VERSION,
    activeProfileName: null,
    profiles: {}
  };
  if (!candidate || typeof candidate !== "object") return fallback;

  const raw = candidate as Record<string, unknown>;
  const next: StoredProfiles = {
    version: (typeof raw.version === "number" && raw.version >= 1 ? raw.version : PROFILE_FILE_VERSION) as 1,
    activeProfileName:
      typeof raw.activeProfileName === "string" && isValidProfileName(raw.activeProfileName)
        ? raw.activeProfileName
        : null,
    profiles: {}
  };

  if (!raw.profiles || typeof raw.profiles !== "object") return next;
  for (const [name, rawProfile] of Object.entries(raw.profiles)) {
    const profile = normalizeProfileCandidate(rawProfile, name);
    if (!profile) continue;
    next.profiles[name] = profile;
  }

  return next;
}

function normalizeProfileCandidate(
  raw: unknown,
  fallbackName?: string
): ConnectionProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" && isValidProfileName(record.name)
    ? record.name
    : fallbackName && isValidProfileName(fallbackName)
      ? fallbackName
      : null;
  if (!name) return null;

  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!isValidProfileUrl(url)) return null;

  const backend = typeof record.backend === "string" && isSupportedProfileBackend(record.backend)
    ? (record.backend as Backend)
    : undefined;
  const authToken = typeof record.authToken === "string" ? record.authToken : null;
  const notes = typeof record.notes === "string" ? record.notes : undefined;
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : createdAt;
  const lastUsedAt = typeof record.lastUsedAt === "number" ? record.lastUsedAt : undefined;

  return {
    name,
    url,
    backend,
    authToken,
    notes,
    createdAt,
    updatedAt,
    lastUsedAt
  };
}

function isSupportedProfileBackend(value: string): boolean {
  return [
    "tmux",
    "ghostty",
    "terminal.app",
    "windows-terminal",
    "cmd",
    "powershell",
    "wsl",
    "console"
  ].includes(value);
}
