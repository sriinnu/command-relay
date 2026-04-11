import {
  ManagedRuntimeAdapter,
  type ManagedRuntimeAdapterOptions,
  type ManagedRuntimePane
} from "@commandrelay/runtime-managed";

/**
 * Legacy constructor options retained for `oly` compatibility.
 */
export interface OlyAdapterOptions extends Omit<ManagedRuntimeAdapterOptions, "command" | "stateDir"> {
  olyCommand?: string;
  olyStateDir?: string | null;
}

export type OlyPane = ManagedRuntimePane;

/**
 * Legacy adapter alias around the managed runtime backend.
 */
export class OlyAdapter extends ManagedRuntimeAdapter {
  /**
   * @param options Backward-compatible options for the managed runtime.
   */
  constructor(options: OlyAdapterOptions = {}) {
    super({
      command: options.olyCommand,
      stateDir: options.olyStateDir ?? null,
      commandTimeoutMs: options.commandTimeoutMs,
      autoStartDaemon: options.autoStartDaemon,
      runCommandImpl: options.runCommandImpl
    });
  }
}
