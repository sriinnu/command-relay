/**
 * @file Helpers for validating and normalizing incoming message fields.
 */

/**
 * Parses a non-empty trimmed string value.
 *
 * @param {unknown} value Candidate value.
 * @returns {string | null} Normalized string or null.
 */
export function parseNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parses an optional integer cursor.
 *
 * @param {unknown} value Candidate value.
 * @returns {number | null} Parsed integer or null when invalid.
 */
export function parseOptionalInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}
