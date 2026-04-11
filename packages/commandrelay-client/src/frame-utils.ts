/**
 * Normalizes websocket frame data into UTF-8 text.
 *
 * @param data Incoming frame payload from `ws`.
 * @returns UTF-8 message text.
 */
export function normalizeIncomingFrame(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  return String(data);
}
