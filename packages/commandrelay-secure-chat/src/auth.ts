import {
  buildAuthProof,
  buildSessionKey,
  generateChallenge,
  generateUserId,
  parseBase64,
  proofsMatch
} from "./crypto.js";
import type { AuthInitResponse, AuthVerifyResponse } from "./types.js";

const CHALLENGE_BYTE_LENGTH = 32;
const SALT_BYTE_LENGTH = 16;
const SESSION_KEY_BYTE_LENGTH = 32;
const USERNAME_MAX_LENGTH = 64;

interface ActiveAuthSession {
  userId: string;
  username: string;
  clientChallenge: Buffer;
  serverChallenge: Buffer;
  salt: Buffer;
  clientAddress: string;
  createdAt: string;
}

/**
 * Lightweight auth helper for the chat server's SRP-like handshake.
 */
export class SecureChatAuthManager {
  private readonly password: string | Buffer;
  private readonly sessions: Map<string, ActiveAuthSession>;

  /**
   * Create an auth manager with a shared password.
   *
   * @param password Shared passphrase for proofs and session derivation.
   */
  public constructor(password: string) {
    this.password = password;
    this.sessions = new Map();
  }

  /**
   * Start an auth exchange for a username and return the challenge package.
   */
  public initAuth(username: string, clientChallenge: Buffer, clientAddress: string): AuthInitResponse {
    if (username.length > USERNAME_MAX_LENGTH) {
      throw new Error("username too long");
    }
    if (clientChallenge.length !== CHALLENGE_BYTE_LENGTH) {
      throw new Error("invalid challenge length");
    }
    if (this.usernameInUse(username)) {
      throw new Error("username taken");
    }

    const serverChallenge = generateChallenge(CHALLENGE_BYTE_LENGTH);
    const salt = generateChallenge(SALT_BYTE_LENGTH);
    const userId = generateUserId();
    const createdAt = new Date().toISOString();

    this.sessions.set(userId, {
      userId,
      username,
      clientChallenge,
      serverChallenge,
      salt,
      clientAddress,
      createdAt
    });

    return {
      user_id: userId,
      B: serverChallenge.toString("base64"),
      salt: salt.toString("base64"),
      room_salt: ""
    };
  }

  /**
   * Verify the client proof and complete the auth exchange.
   */
  public verifyAuth(userId: string, proof: string, clientSessionKey: string): AuthVerifyResponse {
    const session = this.sessions.get(userId);
    if (!session) {
      throw new Error("invalid auth session");
    }

    const expectedClientProof = buildAuthProof(
      this.password,
      session.username,
      session.clientChallenge,
      session.serverChallenge,
      session.salt,
      "client"
    );

    if (!proofsMatch(expectedClientProof, proof)) {
      this.sessions.delete(userId);
      throw new Error("authentication failed");
    }

    parseBase64(proof, { expectedLength: CHALLENGE_BYTE_LENGTH });

    const expectedSessionKey = buildSessionKey(
      this.password,
      session.clientChallenge,
      session.serverChallenge,
      session.salt
    );

    parseBase64(clientSessionKey, { expectedLength: SESSION_KEY_BYTE_LENGTH });
    if (!proofsMatch(expectedSessionKey, clientSessionKey)) {
      this.sessions.delete(userId);
      throw new Error("session key mismatch");
    }

    const proofForServer = buildAuthProof(
      this.password,
      session.username,
      session.clientChallenge,
      session.serverChallenge,
      session.salt,
      "server"
    );

    this.sessions.delete(userId);
    return {
      H_AMK: proofForServer,
      session_key: expectedSessionKey
    };
  }

  /**
   * Remove stale pending auth exchanges older than timeout.
   */
  public cleanupStale(timeoutSeconds: number): number {
    const staleIds = [...this.sessions.entries()]
      .filter(([, session]) => {
        const started = Date.parse(session.createdAt);
        return Number.isNaN(started)
          ? false
          : (Date.now() - started) / 1000 > timeoutSeconds;
      })
      .map(([userId]) => userId);

    for (const userId of staleIds) {
      this.sessions.delete(userId);
    }

    return staleIds.length;
  }

  /**
   * Clear all pending auth exchanges.
   */
  public clear(): void {
    this.sessions.clear();
  }

  /**
   * Remove an auth session when connection no longer wants to continue.
   */
  public revokeSession(userId: string): void {
    this.sessions.delete(userId);
  }

  /**
   * Check whether an active or pending username is already in use.
   */
  public usernameInUse(username: string): boolean {
    return [...this.sessions.values()].some((session) => session.username === username);
  }
}
