import { randomUUID } from "node:crypto";

import type { ChatMessage } from "./types.js";

/**
 * Runtime in-memory message model.
 */
export class MessageRecord implements ChatMessage {
  public readonly id: string;
  public readonly text: string;
  public readonly timestamp: string;
  public readonly userIp: string;
  public readonly username: string;

  /**
   * Create an immutable in-memory message record.
   *
   * @param payload Message payload fields.
   */
  public constructor(payload: { text: string; userIp: string; username: string }) {
    this.id = randomUUID();
    this.text = payload.text;
    this.timestamp = new Date().toISOString();
    this.userIp = payload.userIp;
    this.username = payload.username;
  }
}

/**
 * Active authenticated session in memory.
 */
export class UserSession {
  public readonly userId: string;
  public readonly ip: string;
  public readonly username: string;
  public createdAt: string;
  public lastActivity: string;
  public active: boolean;

  /**
   * Create a tracked authenticated session entry.
   *
   * @param userId Authenticated user ID.
   * @param ip Remote client address.
   * @param username Display name in room.
   */
  public constructor(userId: string, ip: string, username: string) {
    this.userId = userId;
    this.ip = ip;
    this.username = username;
    this.createdAt = new Date().toISOString();
    this.lastActivity = this.createdAt;
    this.active = true;
  }

  /**
   * Update last activity timestamp to current time.
   */
  public touch(): void {
    this.lastActivity = new Date().toISOString();
  }

  /**
   * Check whether the session is stale compared to threshold.
   *
   * @param timeoutSeconds Activity timeout in seconds.
   * @returns True if no activity since timeout window.
   */
  public isStale(timeoutSeconds: number): boolean {
    const last = new Date(this.lastActivity).getTime();
    return (Date.now() - last) / 1000 > timeoutSeconds;
  }
}
