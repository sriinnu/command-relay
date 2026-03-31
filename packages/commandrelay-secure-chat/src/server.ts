import { createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { MessageRecord, UserSession } from "./models.js";
import { ChatMessage, AuthInitResponse, AuthVerifyResponse } from "./types.js";
import { MessageStore, UserSessionStore } from "./stores.js";
import { ConnectionManager } from "./managers.js";
import { SecureChatAuthManager } from "./auth.js";
import { parseBase64 } from "./crypto.js";

type SocketLineMessage = Record<string, unknown>;

const AUTH_TIMEOUT_SECONDS = 30;
const CLIENT_CHALLENGE_BYTES = 32;
const USERNAME_MAX_LENGTH = 64;

interface ChatServerConfig {
  password: string;
}

/**
 * TCP chat server implementation for secure terminal chat.
 */
export class SecureChatServer {
  private readonly messageStore: MessageStore;
  private readonly sessionStore: UserSessionStore;
  private readonly connectionManager: ConnectionManager;
  private readonly authManager: SecureChatAuthManager;
  private readonly roomSalt: Buffer;
  private readonly staleTimeoutSeconds: number;
  private server: Server | null;
  private cleanupTimer: ReturnType<typeof setInterval> | null;

  /**
   * Create a server bound to an in-memory room state.
   *
   * @param config Server configuration.
   */
  public constructor(config: ChatServerConfig) {
    this.messageStore = new MessageStore();
    this.sessionStore = new UserSessionStore();
    this.connectionManager = new ConnectionManager();
    this.authManager = new SecureChatAuthManager(config.password);
    this.roomSalt = randomBytes(16);
    this.staleTimeoutSeconds = AUTH_TIMEOUT_SECONDS;
    this.server = null;
    this.cleanupTimer = null;
  }

  /**
   * Start server and block until socket is bound.
   *
   * @param host Bind host.
   * @param port Bind port.
   * @returns Resolves when the server is listening.
   */
  public async start(host: string, port: number): Promise<void> {
    this.server = createServer((socket) => {
      void this.handleClient(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.once("listening", () => resolve());
      this.server?.listen(port, host);
    });
    this.cleanupTimer = setInterval(() => {
      this.authManager.cleanupStale(this.staleTimeoutSeconds);
      const staleUsers = this.sessionStore.clearInactive(this.staleTimeoutSeconds);
      for (const staleUserId of staleUsers) {
        if (this.connectionManager.disconnect(staleUserId)) {
          void this.connectionManager.broadcast(JSON.stringify({ type: "user_left", user_id: staleUserId }));
        }
      }
    }, 20_000);
  }

  /**
   * Stop server and close all sockets.
   */
  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const userId of this.connectionManager.disconnectAll()) {
      this.sessionStore.remove(userId);
    }
    this.authManager.clear();

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    this.sessionStore.clear();
    this.server = null;
  }

  private async handleClient(socket: Socket): Promise<void> {
    const remoteAddress = socket.remoteAddress ?? "unknown";
    const lineReader = createInterface({ input: socket, terminal: false });
    const iterator = lineReader[Symbol.asyncIterator]();
    let sessionUserId: string | null = null;

    const nextLine = async (): Promise<string | null> => {
      const next = await iterator.next();
      return next.done ? null : next.value;
    };

    try {
      const session = await this.handleAuth(nextLine, socket, remoteAddress);
      if (!session) {
        socket.end();
        return;
      }
      sessionUserId = session.userId;
      await this.handleChat(nextLine, socket, session);
    } catch (error) {
      this.sendError(socket, error instanceof Error ? error.message : String(error));
    } finally {
      if (sessionUserId) {
        this.sessionStore.remove(sessionUserId);
        if (this.connectionManager.disconnect(sessionUserId)) {
          await this.connectionManager.broadcast(
            JSON.stringify({ type: "user_left", user_id: sessionUserId })
          );
        }
      }
      lineReader.close();
      socket.destroy();
    }
  }

  private async handleAuth(
    nextLine: () => Promise<string | null>,
    socket: Socket,
    clientIp: string
  ): Promise<UserSession | null> {
    let pendingAuthUserId: string | null = null;
    const revokePendingAuth = (): void => {
      if (!pendingAuthUserId) {
        return;
      }
      this.authManager.revokeSession(pendingAuthUserId);
      pendingAuthUserId = null;
    };

    const initLine = await nextLine();
    if (!initLine) {
      this.sendError(socket, "empty init payload");
      revokePendingAuth();
      return null;
    }
    const initRequest = parseLine(initLine);
    if (!initRequest || initRequest.cmd !== "srp_init") {
      this.sendError(socket, "expected srp_init");
      revokePendingAuth();
      return null;
    }

    if (typeof initRequest.username !== "string" || !initRequest.username.trim()) {
      this.sendError(socket, "missing username");
      revokePendingAuth();
      return null;
    }
    const username = initRequest.username.trim();
    if (username.length > USERNAME_MAX_LENGTH) {
      this.sendError(socket, "invalid username");
      revokePendingAuth();
      return null;
    }

    if (this.sessionStore.usernameExists(username) || this.authManager.usernameInUse(username)) {
      this.sendError(socket, "Username taken");
      revokePendingAuth();
      return null;
    }

    if (typeof initRequest.A !== "string") {
      this.sendError(socket, "missing A");
      revokePendingAuth();
      return null;
    }
    let clientChallenge: Buffer;
    try {
      clientChallenge = parseBase64(initRequest.A, { expectedLength: CLIENT_CHALLENGE_BYTES });
    } catch {
      this.sendError(socket, "invalid A");
      revokePendingAuth();
      return null;
    }
    let initResponse: AuthInitResponse;
    try {
      initResponse = this.authManager.initAuth(username, clientChallenge, clientIp);
      pendingAuthUserId = initResponse.user_id;
    } catch (error) {
      this.sendError(socket, error instanceof Error ? error.message : String(error));
      revokePendingAuth();
      return null;
    }
    initResponse.room_salt = this.roomSalt.toString("base64");
    try {
      await this.sendJson(socket, initResponse);
    } catch {
      revokePendingAuth();
      throw new Error("failed to send auth init");
    }

    const verifyLine = await nextLine();
    if (!verifyLine) {
      this.sendError(socket, "missing srp_verify");
      revokePendingAuth();
      return null;
    }
    const verifyRequest = parseLine(verifyLine);
    if (!verifyRequest || verifyRequest.cmd !== "srp_verify") {
      this.sendError(socket, "expected srp_verify");
      revokePendingAuth();
      return null;
    }
    if (verifyRequest.user_id !== initResponse.user_id || typeof verifyRequest.M !== "string") {
      this.sendError(socket, "invalid verify request");
      revokePendingAuth();
      return null;
    }

    const expectedSessionKey =
      typeof verifyRequest.session_key === "string" ? verifyRequest.session_key : undefined;
    if (!expectedSessionKey) {
      this.sendError(socket, "missing session key");
      revokePendingAuth();
      return null;
    }

    let authVerify: AuthVerifyResponse;
    try {
      authVerify = this.authManager.verifyAuth(
        initResponse.user_id,
        verifyRequest.M,
        expectedSessionKey
      );
    } catch (error) {
      this.sendError(socket, error instanceof Error ? error.message : String(error));
      revokePendingAuth();
      return null;
    }
    pendingAuthUserId = null;
    const session = new UserSession(initResponse.user_id, clientIp, username);
    await this.sendJson(socket, authVerify);
    this.sessionStore.add(session);
    return session;
  }

  private async handleChat(
    nextLine: () => Promise<string | null>,
    socket: Socket,
    session: UserSession
  ): Promise<void> {
    await this.connectionManager.connect(session.userId, socket);

    await this.sendJson(socket, {
      type: "init",
      messages: this.messageStore.getAll(),
      users: this.sessionStore.getAll().map((entry) => ({
        user_id: entry.userId,
        username: entry.username
      }))
    });

    await this.connectionManager.broadcast(
      JSON.stringify({ type: "user_joined", user_id: session.userId, username: session.username }),
      session.userId
    );

    while (true) {
      const line = await nextLine();
      if (!line) {
        break;
      }
      this.sessionStore.updateActivity(session.userId);

      const payload = parseLine(line);
      if (!payload) {
        continue;
      }
      const messageType = typeof payload.type === "string" ? payload.type : "";
      if (messageType === "message") {
        const messageText = typeof payload.text === "string" ? payload.text : "";
        const record = new MessageRecord({
          text: messageText,
          userIp: session.ip,
          username: session.username
        });
        this.messageStore.add(record);
        await this.connectionManager.broadcast(
          JSON.stringify({ type: "message", data: record as ChatMessage })
        );
        continue;
      }

      if (messageType === "clear") {
        this.messageStore.clear();
        await this.connectionManager.broadcast(JSON.stringify({ type: "cleared" }));
        continue;
      }
    }
  }

  private async sendJson(socket: Socket, data: object): Promise<void> {
    socket.write(`${JSON.stringify(data)}\n`);
  }

  private sendError(socket: Socket, message: string): void {
    void this.sendJson(socket, { error: message });
  }
}

/** Parse and validate one incoming JSON line. */
function parseLine(line: string): SocketLineMessage | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as SocketLineMessage;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
