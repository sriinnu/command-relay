import type { ChatMessage } from "./types.js";
import { MessageRecord, UserSession } from "./models.js";

/**
 * Message store with in-memory retention only.
 */
export class MessageStore {
  private readonly messages: MessageRecord[];

  /**
   * Create an in-memory message store.
   */
  public constructor() {
    this.messages = [];
  }

  /**
   * Add a message record.
   *
   * @param record Message to retain.
   */
  public add(record: MessageRecord): void {
    this.messages.push(record);
  }

  /**
   * Read all retained messages as plain objects.
   *
   * @returns List of chat messages.
   */
  public getAll(): ChatMessage[] {
    return this.messages.map((item) => ({ ...item }));
  }

  /**
   * Remove all messages.
   */
  public clear(): void {
    this.messages.length = 0;
  }

  /**
   * Count retained messages.
   */
  public count(): number {
    return this.messages.length;
  }
}

/**
 * Session store tracking active authenticated clients in memory.
 */
export class UserSessionStore {
  private readonly sessions: Map<string, UserSession>;

  /**
   * Create an in-memory authenticated session index.
   */
  public constructor() {
    this.sessions = new Map();
  }

  /**
   * Add or replace a user session.
   *
   * @param session User session data.
   */
  public add(session: UserSession): void {
    this.sessions.set(session.userId, session);
  }

  /**
   * Read a user session by ID.
   *
   * @param userId User identifier.
   */
  public get(userId: string): UserSession | undefined {
    return this.sessions.get(userId);
  }

  /**
   * Update activity timestamp for a session.
   *
   * @param userId User identifier.
   */
  public updateActivity(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) session.touch();
  }

  /**
   * Remove a user session.
   *
   * @param userId User identifier.
   */
  public remove(userId: string): void {
    this.sessions.delete(userId);
  }

  /**
   * List all sessions.
   *
   * @returns Array of live sessions.
   */
  public getAll(): UserSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Get number of active sessions.
   *
   * @returns Active session count.
   */
  public count(): number {
    return this.sessions.size;
  }

  /**
   * Remove stale sessions by inactivity.
   *
   * @param timeoutSeconds Timeout threshold in seconds.
   * @returns Removed user IDs.
   */
  public clearInactive(timeoutSeconds: number): string[] {
    const stale = [...this.sessions.values()].filter((session) => session.isStale(timeoutSeconds)).map((session) => session.userId);
    for (const userId of stale) {
      this.sessions.delete(userId);
    }
    return stale;
  }

  /**
   * Clear all sessions.
   */
  public clear(): void {
    this.sessions.clear();
  }

  /**
   * Check whether a username is already in use by active session.
   *
   * @param username Display name to check.
   * @returns True when a live session uses the name.
   */
  public usernameExists(username: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.username === username) {
        return true;
      }
    }
    return false;
  }
}
