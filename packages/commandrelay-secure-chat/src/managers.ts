import { Socket } from "node:net";

/**
 * Socket manager for active client streams.
 */
export class ConnectionManager {
  private readonly active: Map<string, Socket>;
  private readonly cleanupHandlers: Map<string, () => void>;

  /**
   * Create a socket tracker for active room participants.
   */
  public constructor() {
    this.active = new Map();
    this.cleanupHandlers = new Map();
  }

  /**
   * Register a socket for a user ID and attach lifecycle cleanup.
   *
   * @param userId User identifier to own this socket.
   * @param socket Active network socket.
   */
  public connect(userId: string, socket: Socket): void {
    this.active.set(userId, socket);
    const cleanup = (): void => {
      const current = this.active.get(userId);
      if (current === socket) {
        this.active.delete(userId);
      }
      socket.off("close", cleanup);
      socket.off("error", cleanup);
      this.cleanupHandlers.delete(userId);
    };
    this.cleanupHandlers.set(userId, cleanup);
    socket.once("close", cleanup);
    socket.once("error", cleanup);
  }

  /**
   * Disconnect a socket and return whether an entry was removed.
   *
   * @param userId User identifier.
   * @returns True if a socket was removed.
   */
  public disconnect(userId: string): boolean {
    const socket = this.active.get(userId);
    if (!socket) {
      return false;
    }
    this.active.delete(userId);
    const cleanup = this.cleanupHandlers.get(userId);
    if (cleanup) {
      socket.off("close", cleanup);
      socket.off("error", cleanup);
      this.cleanupHandlers.delete(userId);
    }
    if (!socket.destroyed) {
      socket.destroy();
    }
    return true;
  }

  /**
   * Disconnect all active users.
   *
   * @returns User IDs that were connected.
   */
  public disconnectAll(): string[] {
    const userIds = [...this.active.keys()];
    for (const userId of userIds) {
      this.disconnect(userId);
    }
    return userIds;
  }

  /**
   * Broadcast a raw message to all active sockets.
   *
   * @param message Message string to send.
   * @param excludeUser Optional user ID to skip (sender).
   */
  public async broadcast(message: string, excludeUser?: string): Promise<void> {
    const disconnected: string[] = [];
    const payload = `${message}\n`;
    for (const [userId, socket] of this.active.entries()) {
      if (excludeUser && userId === excludeUser) {
        continue;
      }
      try {
        if (socket.write(payload) === false) {
          disconnected.push(userId);
        }
      } catch {
        disconnected.push(userId);
      }
    }
    for (const userId of disconnected) {
      this.disconnect(userId);
    }
  }
}
