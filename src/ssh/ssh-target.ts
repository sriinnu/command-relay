/**
 * @file Strict parser and validators for SSH target and profile identifiers.
 */

import { isIP } from "node:net";

const USER_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const HOST_LABEL_PATTERN = /^[A-Za-z0-9-]+$/;
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Parsed representation of an SSH target string.
 */
export interface ParsedSshTarget {
  user: string | null;
  host: string;
  raw: string;
}

/**
 * Parses an SSH target into `{ user, host }` with strict, deterministic validation.
 * Supported forms:
 * - `host`
 * - `user@host`
 * - `user@[2001:db8::1]` (bracketed IPv6)
 *
 * @param raw Raw SSH target string.
 * @returns Parsed target parts when valid.
 * @throws Error when the target is malformed or unsafe.
 */
export function parseSshTarget(raw: string): ParsedSshTarget {
  if (raw.length === 0) {
    throw new Error("SSH target must not be empty.");
  }
  if (/\s/.test(raw)) {
    throw new Error("SSH target must not contain whitespace.");
  }

  const firstAt = raw.indexOf("@");
  const lastAt = raw.lastIndexOf("@");

  let user: string | null = null;
  let host = raw;

  if (firstAt !== -1) {
    if (firstAt !== lastAt) {
      throw new Error("SSH target must contain at most one '@' separator.");
    }

    user = raw.slice(0, firstAt);
    host = raw.slice(firstAt + 1);

    if (user.length === 0) {
      throw new Error("SSH target user is missing before '@'.");
    }
    if (!USER_SEGMENT_PATTERN.test(user)) {
      throw new Error("SSH target user contains unsupported characters.");
    }
  }

  if (host.length === 0) {
    throw new Error("SSH target host is missing.");
  }
  if (!isValidSshHost(host)) {
    throw new Error("SSH target host is invalid.");
  }

  return {
    user,
    host,
    raw
  };
}

/**
 * Returns true when a profile name is safe for deterministic local lookup.
 * This validator intentionally rejects whitespace and shell-sensitive separators.
 *
 * @param raw Candidate profile name.
 * @returns True when the profile name is valid.
 */
export function isValidSshProfileName(raw: string): boolean {
  if (!PROFILE_NAME_PATTERN.test(raw)) {
    return false;
  }
  if (/\s/.test(raw)) {
    return false;
  }
  if (raw.includes("@")) {
    return false;
  }
  return true;
}

function isValidSshHost(rawHost: string): boolean {
  if (rawHost.startsWith("[") || rawHost.endsWith("]")) {
    if (!rawHost.startsWith("[") || !rawHost.endsWith("]")) {
      return false;
    }
    const ipv6 = rawHost.slice(1, -1);
    return ipv6.length > 0 && isIP(ipv6) === 6;
  }

  if (rawHost.includes(":")) {
    return false;
  }

  if (isIP(rawHost) === 4) {
    return true;
  }

  // Treat digit-only dotted quads as IPv4 candidates and reject invalid ranges.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(rawHost)) {
    return false;
  }

  return isValidHostname(rawHost);
}

function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) {
    return false;
  }
  if (hostname.startsWith(".") || hostname.endsWith(".")) {
    return false;
  }

  const labels = hostname.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      return false;
    }
    if (!HOST_LABEL_PATTERN.test(label)) {
      return false;
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return false;
    }
  }

  return true;
}
