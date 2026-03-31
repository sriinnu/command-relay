import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

const ROOM_KEY_INFO = Buffer.from("commandrelay-secure-chat-room-key", "utf8");
const SESSION_KEY_INFO = Buffer.from("commandrelay-secure-chat-session-key", "utf8");
const PROOF_INFO = Buffer.from("commandrelay-secure-chat-proof", "utf8");
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DERIVATION_ROUNDS = 120_000;
const DERIVATION_KEY_BYTES = 32;
const ROOM_KEY_SALT_SEPARATOR = "room-salt";

const BASE64_STANDARD_REGEX =
  /^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/;

/**
 * Derive deterministic room encryption key from password + room salt.
 *
 * @param password Shared passphrase.
 * @param roomSalt Server room salt.
 * @returns 32-byte AES key.
 */
export function deriveRoomKey(password: string | Buffer, roomSalt: Buffer): Buffer {
  const keyMaterial = normalizePassword(password);
  const key = pbkdf2Sync(
    keyMaterial,
    Buffer.concat([roomSalt, Buffer.from(ROOM_KEY_SALT_SEPARATOR, "utf8"), ROOM_KEY_INFO]),
    DERIVATION_ROUNDS,
    DERIVATION_KEY_BYTES,
    "sha256"
  );
  return key;
}

/**
 * Convert a secret into a fixed-size auth key.
 *
 * @param password Shared passphrase.
 * @param salt Per-auth salt.
 * @returns 32-byte key.
 */
export function deriveAuthKey(password: string | Buffer, salt: Buffer): Buffer {
  const keyMaterial = normalizePassword(password);
  return pbkdf2Sync(keyMaterial, salt, DERIVATION_ROUNDS, DERIVATION_KEY_BYTES, "sha256");
}

/**
 * Compute SRP-like proof token for a challenge exchange.
 *
 * @param password Shared passphrase.
 * @param username User name.
 * @param clientChallenge Client challenge.
 * @param serverChallenge Server challenge.
 * @param salt Per-auth salt.
 * @param role Proof direction (client or server).
 * @returns Base64 encoded proof.
 */
export function buildAuthProof(
  password: string | Buffer,
  username: string,
  clientChallenge: Buffer,
  serverChallenge: Buffer,
  salt: Buffer,
  role: "client" | "server"
): string {
  const key = deriveAuthKey(password, salt);
  const payload = Buffer.concat([
    Buffer.from(username, "utf8"),
    Buffer.from("\0"),
    clientChallenge,
    serverChallenge,
    Buffer.from(role),
    PROOF_INFO
  ]);
  return createHmac("sha256", key).update(payload).digest("base64");
}

/**
 * Build a deterministic session key used by server/client framing.
 *
 * @param password Shared passphrase.
 * @param serverChallenge Server challenge.
 * @param clientChallenge Client challenge.
 * @param salt Per-auth salt.
 * @returns Base64 encoded session key.
 */
export function buildSessionKey(
  password: string | Buffer,
  clientChallenge: Buffer,
  serverChallenge: Buffer,
  salt: Buffer
): string {
  const base = Buffer.concat([clientChallenge, serverChallenge, salt]);
  const keyMaterial = deriveAuthKey(password, salt);
  return createHash("sha256").update(keyMaterial).update(base).update(SESSION_KEY_INFO).digest("base64");
}

function normalizePassword(password: string | Buffer): Buffer {
  return typeof password === "string" ? Buffer.from(password, "utf8") : Buffer.from(password);
}

/**
 * Encrypt plaintext for room broadcast.
 *
 * @param plaintext Plain text to encrypt.
 * @param roomKey AES-256-GCM key.
 * @returns Base64 encoded wire token.
 */
export function encryptRoomText(plaintext: string, roomKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, roomKey, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt room message token.
 *
 * @param token Encrypted base64 token.
 * @param roomKey AES-256-GCM key.
 * @returns Plaintext.
 */
export function decryptRoomText(token: string, roomKey: Buffer): string {
  const payload = Buffer.from(token, "base64");
  if (payload.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("ciphertext too small");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, roomKey, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Parse base64 string to bytes with consistent error handling.
 *
 * @param value Base64 encoded input.
 * @returns Byte array.
 */
interface Base64ParseOptions {
  expectedLength?: number;
  minLength?: number;
  maxLength?: number;
}

export function parseBase64(value: string | undefined, options: Base64ParseOptions = {}): Buffer {
  if (!value) {
    throw new Error("missing base64 value");
  }
  const sanitized = value.trim();
  if (!BASE64_STANDARD_REGEX.test(sanitized)) {
    throw new Error("invalid base64");
  }
  try {
    const decoded = Buffer.from(sanitized, "base64");
    const normalized = decoded.toString("base64").replace(/=+$/, "");
    if (normalized !== sanitized.replace(/=+$/, "")) {
      throw new Error("invalid base64");
    }

    if (options.expectedLength && decoded.length !== options.expectedLength) {
      throw new Error("invalid base64 length");
    }

    if (options.minLength !== undefined && decoded.length < options.minLength) {
      throw new Error("invalid base64 length");
    }

    if (options.maxLength !== undefined && decoded.length > options.maxLength) {
      throw new Error("invalid base64 length");
    }

    return decoded;
  } catch {
    throw new Error("invalid base64");
  }
}

/**
 * Generate a random user id.
 *
 * @returns UUID string.
 */
export function generateUserId(): string {
  return randomUUID();
}

/**
 * Generate random challenge bytes.
 *
 * @param length Number of random bytes.
 * @returns Challenge bytes.
 */
export function generateChallenge(length: number): Buffer {
  return randomBytes(Math.max(1, length));
}

/**
 * Constant-time comparison for base64 proofs.
 *
 * @param expected Expected token.
 * @param actual Actual token.
 * @returns Whether tokens match.
 */
export function proofsMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "base64");
  const actualBytes = Buffer.from(actual, "base64");
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, actualBytes);
}
