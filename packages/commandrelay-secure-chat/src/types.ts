/**
 * Shared protocol and domain types for secure chat.
 */

/**
 * Chat message payload persisted in-memory only.
 */
export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  userIp: string;
  username: string;
}

/**
 * User session snapshot shared with clients.
 */
export interface ChatUser {
  user_id: string;
  username: string;
}

/**
 * Serialized auth initialization response from server.
 */
export interface AuthInitResponse {
  user_id: string;
  B: string;
  salt: string;
  room_salt: string;
}

/**
 * Serialized auth verification response from server.
 */
export interface AuthVerifyResponse {
  H_AMK: string;
  session_key: string;
}

/**
 * Parsed command line config for server/client CLI.
 */
export interface ChatCliContext {
  command: "serve" | "connect";
  host: string;
  port: number;
  username: string;
  password: string;
}
