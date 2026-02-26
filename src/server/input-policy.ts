/**
 * @file Input policy helpers for client-level and global bridge input controls.
 */

/** Input policy context for a single client request. */
export interface InputPolicyContext {
  globalInputDisabled: boolean;
  clientInputEnabled: boolean;
}

/** Input policy state returned to clients. */
export interface InputPolicyState {
  inputEnabled: boolean;
  globalInputDisabled: boolean;
}

/**
 * Builds a policy response payload for client state updates.
 *
 * @param context Policy context for the client.
 * @returns Serialized policy payload.
 */
export function buildInputPolicyState(context: InputPolicyContext): InputPolicyState {
  return {
    inputEnabled: context.clientInputEnabled && !context.globalInputDisabled,
    globalInputDisabled: context.globalInputDisabled
  };
}

/**
 * Checks whether input may be accepted under current policy.
 *
 * @param context Policy context for the client.
 * @returns True when input is allowed.
 */
export function isInputAllowed(context: InputPolicyContext): boolean {
  return context.clientInputEnabled && !context.globalInputDisabled;
}
