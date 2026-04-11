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

/** Persisted in-memory audit event with server timestamp. */
export interface PersistedAuditEvent extends AuditEvent {
  ts: number;
}

/** Optional in-process sink for tests and telemetry hooks. */
export type AuditEventSink = (event: PersistedAuditEvent) => void;

/** Audit logger constructor options. */
export interface AuditLoggerOptions {
  path: string | null;
  logger?: Pick<Console, "warn"> & { audit?: AuditEventSink };
}

/**
 * Audit logger that writes JSON lines to disk when configured.
 */
export class AuditLogger {
  private readonly path: string | null;
  private readonly logger: Pick<Console, "warn">;
  private readonly sink: AuditEventSink | null;

  /**
   * @param options Logger options.
   */
  constructor(options: AuditLoggerOptions) {
    this.path = options.path;
    this.logger = options.logger ?? console;
    this.sink = typeof options.logger?.audit === "function" ? options.logger.audit : null;
  }

  /**
   * Writes an audit event using best-effort semantics.
   *
   * @param event Event payload.
   * @returns Completes once write attempt finishes.
   */
  async write(event: AuditEvent): Promise<void> {
    const persistedEvent: PersistedAuditEvent = {
      ts: Date.now(),
      action: event.action,
      clientId: event.clientId,
      details: event.details
    };
    this.writeToSink(persistedEvent);

    if (!this.path) return;

    const line = JSON.stringify(persistedEvent);
    try {
      await appendFile(this.path, `${line}\n`, "utf8");
    } catch (error) {
      this.logger.warn(
        `[bridge] audit write failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private writeToSink(event: PersistedAuditEvent): void {
    if (!this.sink) return;

    try {
      this.sink(event);
    } catch (error) {
      this.logger.warn(
        `[bridge] audit sink failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
