import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { ChatMessage } from "./types.js";
import {
  buildAuthProof,
  decryptRoomText,
  deriveRoomKey,
  encryptRoomText,
  buildSessionKey,
  parseBase64,
  proofsMatch
} from "./crypto.js";

const AUTH_CHALLENGE_BYTES = 32;
const ROOM_SALT_BYTES = 16;
const SERVER_CHALLENGE_BYTES = 32;
const SESSION_KEY_BYTES = 32;

interface ParsedMessage extends Record<string, unknown> {}
interface SocketPayload extends Record<string, unknown> {}

interface RoomUser {
  user_id: string;
  username: string;
}

/**
 * Interactive terminal client for secure chat.
 */
export class SecureChatClient {
  private readonly server: string;
  private readonly port: number;
  private readonly username: string;
  private readonly password: string;
  private socket: Socket | null;
  private roomKey: Buffer | null;
  private messages: ChatMessage[];
  private users: RoomUser[];
  private running: boolean;
  private lineReader: AsyncIterator<string> | null;
  private inputReader: ReadlineInterface | null;

  /**
   * Create a chat client for a target server.
   *
   * @param server Server hostname.
   * @param port Server port.
   * @param username Username to display in room.
   * @param password Shared room password.
   */
  public constructor(server: string, port: number, username: string, password: string) {
    this.server = server;
    this.port = port;
    this.username = username;
    this.password = password;
    this.socket = null;
    this.roomKey = null;
    this.messages = [];
    this.users = [];
    this.running = false;
    this.lineReader = null;
    this.inputReader = null;
  }

  /**
   * Execute full client lifecycle.
   */
  public async runAsync(): Promise<void> {
    const socket = createConnection({ host: this.server, port: this.port, timeout: 10_000 });
    this.socket = socket;
    const lineReader = createInterface({ input: socket, terminal: false })[Symbol.asyncIterator]();
    this.lineReader = lineReader;

    try {
      await this.waitForConnected(socket);
      await this.authenticate();
      this.running = true;
      await Promise.race([this.receiveLoop(), this.inputLoop()]);
    } finally {
      this.running = false;
      this.inputReader?.close();
      this.inputReader = null;
      socket.destroy();
      this.lineReader = null;
      this.socket = null;
      this.roomKey = null;
    }
  }

  /**
   * Authenticate using the server's challenge flow.
   */
  public async authenticate(): Promise<void> {
    if (!this.socket) {
      throw new Error("not connected");
    }

    const clientChallenge = randomBytes(AUTH_CHALLENGE_BYTES);
    const clientChallengeRaw = clientChallenge.toString("base64");
    await this.sendJson({
      cmd: "srp_init",
      username: this.username,
      A: clientChallengeRaw
    });

    const initPayload = parseMessage(await this.nextMessage(), "srp_init response");
    if ("error" in initPayload) {
      throw new Error(String(initPayload.error));
    }

    const initUserId = parseString(initPayload.user_id);
    const roomSaltRaw = parseString(initPayload.room_salt);
    const serverChallengeRaw = parseString(initPayload.B);
    const saltRaw = parseString(initPayload.salt);
    if (!initUserId || !roomSaltRaw || !serverChallengeRaw || !saltRaw) {
      throw new Error("Invalid auth init payload");
    }

    const roomSalt = parseBase64(roomSaltRaw, { expectedLength: ROOM_SALT_BYTES });
    const serverChallenge = parseBase64(serverChallengeRaw, { expectedLength: SERVER_CHALLENGE_BYTES });
    const salt = parseBase64(saltRaw, { expectedLength: ROOM_SALT_BYTES });
    const proof = buildAuthProof(
      this.password,
      this.username,
      clientChallenge,
      serverChallenge,
      salt,
      "client"
    );

    const expectedSessionKey = buildSessionKey(
      this.password,
      clientChallenge,
      serverChallenge,
      salt
    );
    await this.sendJson({
      cmd: "srp_verify",
      user_id: initUserId,
      M: proof,
      session_key: expectedSessionKey
    });

    const verifyPayload = parseMessage(await this.nextMessage(), "auth verify");
    if ("error" in verifyPayload) {
      throw new Error(String(verifyPayload.error));
    }

    const rawSessionKey = parseString(verifyPayload.session_key);
    if (!rawSessionKey) {
      throw new Error("Missing session key");
    }
    parseBase64(rawSessionKey, { expectedLength: SESSION_KEY_BYTES });
    if (!proofsMatch(expectedSessionKey, rawSessionKey)) {
      throw new Error("session key mismatch");
    }

    const expectedServerProof = buildAuthProof(
      this.password,
      this.username,
      clientChallenge,
      serverChallenge,
      salt,
      "server"
    );
    const actualServerProof = parseString(verifyPayload.H_AMK);
    if (!actualServerProof || !proofsMatch(expectedServerProof, actualServerProof)) {
      throw new Error("server authentication failed");
    }

    this.roomKey = deriveRoomKey(this.password, roomSalt);
  }

  /**
   * Decrypt and sanitize messages from room payload.
   */
  private decryptMessage(
    message: Record<string, unknown>
  ): { text?: string; [key: string]: unknown } {
    if (typeof message.text !== "string" || !this.roomKey) {
      return message;
    }

    try {
      return { ...message, text: decryptRoomText(message.text, this.roomKey) };
    } catch {
      return { ...message, text: "[decrypt failed]" };
    }
  }

  /**
   * Render current state in a compact terminal view.
   */
  private renderMessages(): void {
    console.clear();
    console.log("commandrelay-secure-chat");
    const users = this.users.map((entry) => entry.username).join(", ") || "none";
    console.log(`online: ${users}`);
    console.log("-".repeat(60));
    for (const message of this.messages.slice(-15)) {
      console.log(
        `${message.timestamp.substring(0, 19).replace("T", " ")} ${message.username}: ${message.text}`
      );
    }
    console.log("-".repeat(60));
    console.log("Type message and press Enter. q to quit.");
  }

  private async receiveLoop(): Promise<void> {
    while (this.running) {
      const next = await this.nextMessage();
      if (!next) {
        break;
      }

      const type = typeof next.type === "string" ? next.type : "";
      if (typeof next.error === "string") {
        console.error(`server error: ${next.error}`);
        this.running = false;
        break;
      }

      if (type === "init") {
        const rawMessages = Array.isArray(next.messages) ? next.messages : [];
        const rawUsers = Array.isArray(next.users) ? next.users : [];
        this.messages = rawMessages
          .map((entry) => toChatMessage(this.decryptMessage(normalizeRecord(entry))));
        this.users = rawUsers
          .map((entry) => parseRoomUser(normalizeRecord(entry)))
          .filter((entry): entry is RoomUser => entry !== null);
        this.renderMessages();
        continue;
      }

      if (type === "message") {
        const data = normalizeRecord(next.data);
        const decrypted = this.decryptMessage(data);
        const message = toChatMessage(decrypted);
        this.messages.push(message);
        this.renderMessages();
        continue;
      }

      if (type === "user_joined") {
        const candidate = parseRoomUser(next);
        if (
          candidate &&
          !this.users.some((entry) => entry.user_id === candidate.user_id)
        ) {
          this.users.push(candidate);
          this.renderMessages();
        }
        continue;
      }

      if (type === "user_left") {
        if (typeof next.user_id === "string") {
          this.users = this.users.filter((entry) => entry.user_id !== next.user_id);
          this.renderMessages();
        }
        continue;
      }

      if (type === "cleared") {
        this.messages = [];
        this.renderMessages();
      }
    }
  }

  private async inputLoop(): Promise<void> {
    const lineReader = createInterface({ input: process.stdin, output: process.stdout }) as ReadlineInterface;
    this.inputReader = lineReader;

    try {
      for await (const text of lineReader) {
        if (!this.running) {
          break;
        }

        const trimmed = text.trim();
        if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
          this.running = false;
          this.socket?.destroy();
          break;
        }
        if (!trimmed) {
          continue;
        }
        if (!this.roomKey) {
          console.error("room key unavailable");
          continue;
        }

        const encrypted = encryptRoomText(trimmed, this.roomKey);
        await this.sendJson({ type: "message", text: encrypted });
      }
    } finally {
      if (this.inputReader === lineReader) {
        this.inputReader = null;
      }
      lineReader.close();
      this.running = false;
    }
  }

  private async sendJson(payload: SocketPayload): Promise<void> {
    if (!this.socket) {
      return;
    }
    this.socket.write(`${JSON.stringify(payload)}\n`);
  }

  private async nextMessage(): Promise<SocketPayload | null> {
    if (!this.lineReader) {
      return null;
    }
    const next = await this.lineReader.next();
    if (next.done) {
      return null;
    }
    const parsed = parseLine(next.value);
    return parsed ?? null;
  }

  private async waitForConnected(socket: Socket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("connection timeout"));
      }, 10_000);

      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error as Error);
      });
    });
  }
}

function isChatMessage(candidate: unknown): candidate is ChatMessage {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.userIp === "string" &&
    typeof record.username === "string"
  );
}

function parseRoomUser(payload: ParsedMessage): RoomUser | null {
  if (typeof payload.user_id !== "string" || typeof payload.username !== "string") {
    return null;
  }
  return { user_id: payload.user_id, username: payload.username };
}

function parseMessage(message: SocketPayload | null, context: string): ParsedMessage {
  if (!message) {
    throw new Error(`${context}: invalid payload`);
  }
  if (typeof message !== "object") {
    throw new Error(`${context}: invalid payload`);
  }
  return message as ParsedMessage;
}

function parseLine(raw: string): SocketPayload | null {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SocketPayload;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toChatMessage(entry: Record<string, unknown>): ChatMessage {
  if (isChatMessage(entry)) {
    return entry;
  }
  return {
    id: parseString(entry.id) ?? `msg-${Date.now()}-${Math.round(Math.random() * 9999)}`,
    text: parseString(entry.text) ?? "",
    timestamp: parseString(entry.timestamp) ?? new Date().toISOString(),
    userIp: parseString(entry.userIp) ?? "unknown",
    username: parseString(entry.username) ?? "unknown"
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
