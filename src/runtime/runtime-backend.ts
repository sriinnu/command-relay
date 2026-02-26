/**
 * @file Runtime backend contract shared by pluggable terminal runtimes.
 */

/**
 * Generic pane metadata returned by runtime backends.
 */
export interface RuntimePane {
  paneId: string;
  [key: string]: unknown;
}

/**
 * Backend contract expected by the bridge server runtime layer.
 */
export interface RuntimeBackend {
  /**
   * Stable backend identifier used for pane id namespacing.
   */
  readonly backendId: string;

  /**
   * Checks whether the backend can serve runtime operations.
   *
   * @returns True when backend is reachable and operational.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Lists available panes managed by the backend.
   *
   * @returns Pane metadata rows.
   */
  listPanes(): Promise<RuntimePane[]>;

  /**
   * Captures output for a pane.
   *
   * @param paneId Backend-native pane id.
   * @param lines Number of lines to capture.
   * @returns Captured pane output.
   */
  capturePane(paneId: string, lines: number): Promise<string>;

  /**
   * Sends input to a pane.
   *
   * @param paneId Backend-native pane id.
   * @param input Raw input payload.
   * @returns Completes when input is dispatched.
   */
  sendInput(paneId: string, input: string): Promise<void>;
}
