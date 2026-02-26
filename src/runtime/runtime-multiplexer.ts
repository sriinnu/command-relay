/**
 * @file Runtime backend multiplexer with pane-id routing and namespacing.
 */

import type { RuntimeBackend, RuntimePane } from "./runtime-backend.js";

const PANE_ID_DELIMITER = ":";

interface RoutedPaneTarget {
  backend: RuntimeBackend;
  rawPaneId: string;
}

/**
 * Constructor options for {@link RuntimeMultiplexer}.
 */
export interface RuntimeMultiplexerOptions {
  backends: RuntimeBackend[];
}

/**
 * Multiplexes multiple runtime backends behind the bridge runtime contract.
 */
export class RuntimeMultiplexer {
  private readonly backends: RuntimeBackend[];
  private readonly backendById: Map<string, RuntimeBackend>;
  private readonly shouldNamespacePaneIds: boolean;

  /**
   * @param options Runtime backend collection.
   */
  constructor(options: RuntimeMultiplexerOptions) {
    const backends = [...options.backends];
    if (backends.length === 0) {
      throw new Error("RuntimeMultiplexer requires at least one backend");
    }

    this.backends = backends;
    this.backendById = new Map();
    this.shouldNamespacePaneIds = backends.length > 1;
    this.validateBackends(backends);
  }

  /**
   * Checks whether at least one backend is reachable.
   *
   * @returns True when any backend is available.
   */
  async isAvailable(): Promise<boolean> {
    const availability = await Promise.all(this.backends.map((backend) => this.safeIsAvailable(backend)));
    return availability.some(Boolean);
  }

  /**
   * Lists panes from all reachable backends.
   *
   * @returns Aggregated pane metadata.
   */
  async listPanes(): Promise<RuntimePane[]> {
    const paneGroups = await Promise.all(
      this.backends.map(async (backend): Promise<RuntimePane[]> => {
        if (!(await this.safeIsAvailable(backend))) return [];

        const panes = await backend.listPanes();
        if (!this.shouldNamespacePaneIds) return panes;

        return panes.map((pane) => ({
          ...pane,
          paneId: this.buildNamespacedPaneId(backend.backendId, pane.paneId)
        }));
      })
    );

    return paneGroups.flat();
  }

  /**
   * Captures pane output by routing the pane id to its backend.
   *
   * @param paneId Routed pane id.
   * @param lines Number of lines to capture.
   * @returns Captured output.
   */
  async capturePane(paneId: string, lines: number): Promise<string> {
    const target = this.resolvePaneTarget(paneId);
    return await target.backend.capturePane(target.rawPaneId, lines);
  }

  /**
   * Sends input to the backend that owns the pane id.
   *
   * @param paneId Routed pane id.
   * @param input Input payload.
   * @returns Completes when dispatched.
   */
  async sendInput(paneId: string, input: string): Promise<void> {
    const target = this.resolvePaneTarget(paneId);
    await target.backend.sendInput(target.rawPaneId, input);
  }

  private validateBackends(backends: RuntimeBackend[]): void {
    for (const backend of backends) {
      if (!backend || typeof backend !== "object") {
        throw new Error("Runtime backend must be an object");
      }
      if (typeof backend.backendId !== "string" || backend.backendId.trim().length === 0) {
        throw new Error("Runtime backend id must be a non-empty string");
      }
      if (backend.backendId.includes(PANE_ID_DELIMITER)) {
        throw new Error(
          `Runtime backend id "${backend.backendId}" cannot contain "${PANE_ID_DELIMITER}"`
        );
      }
      if (this.backendById.has(backend.backendId)) {
        throw new Error(`Duplicate runtime backend id "${backend.backendId}"`);
      }
      this.backendById.set(backend.backendId, backend);
    }
  }

  private async safeIsAvailable(backend: RuntimeBackend): Promise<boolean> {
    try {
      return await backend.isAvailable();
    } catch {
      return false;
    }
  }

  private buildNamespacedPaneId(backendId: string, rawPaneId: string): string {
    return `${backendId}${PANE_ID_DELIMITER}${rawPaneId}`;
  }

  private resolvePaneTarget(paneId: string): RoutedPaneTarget {
    if (!this.shouldNamespacePaneIds) {
      return { backend: this.backends[0], rawPaneId: paneId };
    }

    const separatorIndex = paneId.indexOf(PANE_ID_DELIMITER);
    if (separatorIndex <= 0 || separatorIndex === paneId.length - 1) {
      throw new Error(
        `Pane id "${paneId}" must be namespaced as "<backendId>${PANE_ID_DELIMITER}<rawPaneId>"`
      );
    }

    const backendId = paneId.slice(0, separatorIndex);
    const rawPaneId = paneId.slice(separatorIndex + 1);
    const backend = this.backendById.get(backendId);
    if (!backend) {
      throw new Error(`Unknown runtime backend "${backendId}" for pane id "${paneId}"`);
    }

    return { backend, rawPaneId };
  }
}
