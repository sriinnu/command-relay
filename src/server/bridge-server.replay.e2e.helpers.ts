/**
 * @file Shared helper utilities for replay websocket end-to-end tests.
 */

import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import WebSocket from "ws";

export interface Envelope {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

export interface WsProbe {
  socket: WebSocket;
  sendRequest: (type: string, requestId: string, payload: Record<string, unknown>) => void;
  next: (predicate: (message: Envelope) => boolean, timeoutMs?: number) => Promise<Envelope>;
  collect: (
    predicate: (message: Envelope) => boolean,
    count: number,
    timeoutMs?: number
  ) => Promise<Envelope[]>;
  expectNone: (predicate: (message: Envelope) => boolean, timeoutMs?: number) => Promise<void>;
}

export interface FakeTmux {
  isAvailable: () => Promise<boolean>;
  listPanes: () => Promise<Array<Record<string, unknown>>>;
  sendInput: (paneId: string, input: string) => Promise<void>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

export const HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 3_500;

/**
 * Waits for a short duration.
 *
 * @param ms Sleep duration in milliseconds.
 * @returns Promise that resolves after the delay.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reserves a free loopback TCP port.
 *
 * @returns Available port number.
 */
export async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to resolve reserved port")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

/**
 * Checks whether this runtime can bind loopback TCP ports for e2e tests.
 *
 * @returns True when loopback bind/listen is available.
 */
export async function canBindLoopback(): Promise<boolean> {
  try {
    const port = await reservePort();
    return port > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (String((error as { code?: unknown }).code) === "EPERM") {
        return false;
      }
    }
    throw error;
  }
}

/**
 * Creates a fake tmux adapter with deterministic capture snapshots.
 *
 * @param outputs Ordered snapshots returned on successive capture calls.
 * @returns Fake tmux implementation.
 */
export function createReplayTmux(outputs: string[]): FakeTmux {
  let captureIndex = 0;
  let last = outputs[0] ?? "";

  return {
    isAvailable: async () => true,
    listPanes: async () => [
      {
        sessionName: "main",
        windowName: "editor",
        paneId: "%1",
        paneIndex: 0,
        paneCurrentCommand: "bash"
      }
    ],
    sendInput: async () => undefined,
    capturePane: async () => {
      const boundedIndex = Math.min(captureIndex, outputs.length - 1);
      const next = outputs[boundedIndex] ?? last;
      captureIndex += 1;
      last = next;
      return next;
    }
  };
}

/**
 * Connects a websocket probe and records inbound envelopes.
 *
 * @param url WebSocket URL.
 * @returns Connected probe utilities.
 */
export async function createWsProbe(url: string): Promise<WsProbe> {
  const socket = new WebSocket(url);
  const queue: Envelope[] = [];
  const pullMatchingMessage = async (
    predicate: (message: Envelope) => boolean,
    timeoutMs: number
  ): Promise<Envelope> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = queue.findIndex(predicate);
      if (index >= 0) {
        const [message] = queue.splice(index, 1);
        if (message) {
          return message;
        }
      }
      await sleep(10);
    }
    throw new Error(`timed out waiting for websocket event after ${timeoutMs}ms`);
  };

  socket.on("message", (rawData) => {
    const raw = typeof rawData === "string" ? rawData : rawData.toString();
    queue.push(JSON.parse(raw) as Envelope);
  });

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };

    socket.on("open", onOpen);
    socket.on("error", onError);
  });

  return {
    socket,
    sendRequest: (type, requestId, payload) => {
      socket.send(
        JSON.stringify({
          v: 1,
          type,
          requestId,
          timestamp: Date.now(),
          payload
        })
      );
    },
    next: async (predicate, timeoutMs = DEFAULT_TIMEOUT_MS) =>
      await pullMatchingMessage(predicate, timeoutMs),
    collect: async (predicate, count, timeoutMs = DEFAULT_TIMEOUT_MS) => {
      const messages: Envelope[] = [];
      const deadline = Date.now() + timeoutMs;
      while (messages.length < count && Date.now() < deadline) {
        const remaining = Math.max(deadline - Date.now(), 1);
        messages.push(await pullMatchingMessage(predicate, remaining));
      }
      if (messages.length !== count) {
        throw new Error(`timed out collecting ${count} messages after ${timeoutMs}ms`);
      }
      return messages;
    },
    expectNone: async (predicate, timeoutMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = queue.find(predicate);
        if (hit) {
          throw new Error(`expected no matching messages but received ${JSON.stringify(hit)}`);
        }
        await sleep(10);
      }
    }
  };
}

/**
 * Closes a websocket probe safely.
 *
 * @param socket Probe socket.
 * @returns Resolves after socket closes.
 */
export async function closeWs(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onClose = () => {
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 750);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("close", onClose);
    };

    socket.on("close", onClose);
    socket.close();
  });
}

/**
 * Checks if a message is an output event for the given pane.
 *
 * @param message Websocket envelope.
 * @param paneId Pane id.
 * @returns True when envelope is matching output.
 */
export function isPaneOutput(message: Envelope, paneId: string): boolean {
  return (
    message.type === "output"
    && message.payload.paneId === paneId
    && typeof message.payload.streamSeq === "number"
  );
}

/**
 * Extracts numeric stream sequence from an output envelope.
 *
 * @param message Output message.
 * @returns Stream sequence.
 */
export function streamSeq(message: Envelope): number {
  const value = message.payload.streamSeq;
  if (typeof value !== "number") {
    throw new Error(`missing numeric streamSeq in output envelope: ${JSON.stringify(message)}`);
  }
  return value;
}

/**
 * Asserts that sequence numbers are strictly increasing.
 *
 * @param seqs Sequence numbers.
 */
export function assertStrictlyIncreasing(seqs: number[]): void {
  for (let i = 1; i < seqs.length; i += 1) {
    assert.ok(seqs[i] > seqs[i - 1], `expected strictly increasing seqs, got ${seqs}`);
  }
}
