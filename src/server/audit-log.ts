/**
 * @file Structured audit logger for sensitive bridge operations.
 */

import { appendFile } from "node:fs/promises";

/** Structured audit event payload. */
export interface AuditEvent {
  action: string;
  clientId: string;
  details: Record<string, unknown>;
}

/** Audit logger constructor options. */
export interface AuditLoggerOptions {
  path: string | null;
  logger?: Pick<Console, "warn">;
}

/**
 * Audit logger that writes JSON lines to disk when configured.
 */
export class AuditLogger {
  private readonly path: string | null;
  private readonly logger: Pick<Console, "warn">;

  /**
   * @param options Logger options.
   */
  constructor(options: AuditLoggerOptions) {
    this.path = options.path;
    this.logger = options.logger ?? console;
  }

  /**
   * Writes an audit event using best-effort semantics.
   *
   * @param event Event payload.
   * @returns Completes once write attempt finishes.
   */
  async write(event: AuditEvent): Promise<void> {
    const line = JSON.stringify({
      ts: Date.now(),
      action: event.action,
      clientId: event.clientId,
      details: event.details
    });

    if (!this.path) return;

    try {
      await appendFile(this.path, `${line}\n`, "utf8");
    } catch (error) {
      this.logger.warn(
        `[bridge] audit write failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
