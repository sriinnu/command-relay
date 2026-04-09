/**
 * @file Strict typed state machine for client-visible SSH session control state.
 */

/** Client-visible SSH control states. */
export type SshSessionControlState =
  | "offline"
  | "connecting"
  | "connected"
  | "attached"
  | "reconnecting"
  | "replaying";

/**
 * Transition map used to derive legal events and next-state typing.
 */
export interface SshSessionTransitionMap {
  offline: {
    start_connect: "connecting";
  };
  connecting: {
    connect_succeeded: "connected";
    connect_failed: "offline";
    disconnect: "offline";
  };
  connected: {
    attach: "attached";
    disconnect: "offline";
    connection_lost: "reconnecting";
  };
  attached: {
    detach: "connected";
    disconnect: "offline";
    connection_lost: "reconnecting";
  };
  reconnecting: {
    reconnect_succeeded: "connected";
    reconnect_failed: "offline";
    begin_replay: "replaying";
    disconnect: "offline";
  };
  replaying: {
    replay_completed: "attached";
    replay_failed: "connected";
    connection_lost: "reconnecting";
    disconnect: "offline";
  };
}

/** Union of all legal transition event names. */
export type SshSessionTransitionEvent = {
  [TState in SshSessionControlState]: keyof SshSessionTransitionMap[TState];
}[SshSessionControlState];

/** Transition events allowed from a specific state. */
export type SshSessionAllowedEvent<TState extends SshSessionControlState> =
  keyof SshSessionTransitionMap[TState];

/** Next-state type for a state + event pair. */
export type SshSessionNextState<
  TState extends SshSessionControlState,
  TEvent extends SshSessionAllowedEvent<TState>
> = SshSessionTransitionMap[TState][TEvent];

/**
 * Context metadata supplied by callers so transition output remains deterministic.
 */
export interface SshSessionTransitionContext {
  sequence: number;
  atMs: number;
}

/** Deterministic code describing why a transition was rejected. */
export type SshSessionTransitionRejectionReason = "invalid_transition";

/**
 * Deterministic transition log entry shape for both accepted and rejected transitions.
 */
export interface SshSessionTransitionLogEntry {
  sequence: number;
  atMs: number;
  from: SshSessionControlState;
  event: SshSessionTransitionEvent;
  to: SshSessionControlState;
  accepted: boolean;
  reason: SshSessionTransitionRejectionReason | null;
}

/** Result returned by each transition attempt. */
export interface SshSessionTransitionResult {
  state: SshSessionControlState;
  changed: boolean;
  log: SshSessionTransitionLogEntry;
}

/** Canonical initial state for SSH session control lifecycle. */
export const SSH_SESSION_INITIAL_STATE: SshSessionControlState = "offline";

const TRANSITIONS: SshSessionTransitionMap = {
  offline: {
    start_connect: "connecting"
  },
  connecting: {
    connect_succeeded: "connected",
    connect_failed: "offline",
    disconnect: "offline"
  },
  connected: {
    attach: "attached",
    disconnect: "offline",
    connection_lost: "reconnecting"
  },
  attached: {
    detach: "connected",
    disconnect: "offline",
    connection_lost: "reconnecting"
  },
  reconnecting: {
    reconnect_succeeded: "connected",
    reconnect_failed: "offline",
    begin_replay: "replaying",
    disconnect: "offline"
  },
  replaying: {
    replay_completed: "attached",
    replay_failed: "connected",
    connection_lost: "reconnecting",
    disconnect: "offline"
  }
};

/**
 * Checks whether a transition event is valid for a state.
 *
 * @param state Current state.
 * @param event Requested transition event.
 * @returns True when event is legal for the provided state.
 */
export function isTransitionAllowed(
  state: SshSessionControlState,
  event: SshSessionTransitionEvent
): boolean {
  const transitions = TRANSITIONS[state] as Record<string, SshSessionControlState>;
  return event in transitions;
}

/**
 * Returns true when the state currently allows direct input dispatch.
 *
 * @param state SSH session state.
 * @returns True when input can be sent immediately.
 */
export function isInputEnabledState(state: SshSessionControlState): state is "attached" {
  return state === "attached";
}

/**
 * Returns true when input may become enabled without reconnecting from scratch.
 *
 * @param state SSH session state.
 * @returns True when the state is input-capable now or after immediate control flow.
 */
export function canEnableInputFromState(state: SshSessionControlState): boolean {
  return state === "connected" || state === "attached" || state === "replaying";
}

/**
 * Applies a state transition and returns deterministic transition metadata.
 * Invalid transitions are guarded and reported as rejected log entries.
 *
 * @param state Current state.
 * @param event Requested transition event.
 * @param context Deterministic metadata context.
 * @returns New state and transition log metadata.
 */
export function transitionSshSessionState(
  state: SshSessionControlState,
  event: SshSessionTransitionEvent,
  context: SshSessionTransitionContext
): SshSessionTransitionResult {
  const transitions = TRANSITIONS[state] as Partial<Record<SshSessionTransitionEvent, SshSessionControlState>>;
  const nextState = transitions[event];

  if (!nextState) {
    return {
      state,
      changed: false,
      log: {
        sequence: context.sequence,
        atMs: context.atMs,
        from: state,
        event,
        to: state,
        accepted: false,
        reason: "invalid_transition"
      }
    };
  }

  return {
    state: nextState,
    changed: nextState !== state,
    log: {
      sequence: context.sequence,
      atMs: context.atMs,
      from: state,
      event,
      to: nextState,
      accepted: true,
      reason: null
    }
  };
}
