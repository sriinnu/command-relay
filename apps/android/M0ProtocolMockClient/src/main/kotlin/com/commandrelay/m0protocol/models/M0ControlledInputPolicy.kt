package com.commandrelay.m0protocol.models

import kotlinx.serialization.Serializable

/**
 * Access policy returned by auth endpoints.
 *
 * Mirrors the iOS `SessionCapabilities` semantics for read-only-first behavior.
 *
 * @property readOnly Whether the session starts in read-only mode.
 * @property canEnableInput Whether the user can explicitly opt into input.
 */
@Serializable
public data class M0SessionCapabilities(
    public val readOnly: Boolean,
    public val canEnableInput: Boolean,
)

/**
 * Input policy context for a single client.
 *
 * @property globalInputDisabled Global kill-switch state from the gateway.
 * @property clientInputEnabled Client-local input toggle state.
 */
@Serializable
public data class M0ControlledInputPolicyContext(
    public val globalInputDisabled: Boolean,
    public val clientInputEnabled: Boolean,
)

/**
 * Effective input policy state returned to clients.
 *
 * @property inputEnabled True only when client input is enabled and global input is not disabled.
 * @property globalInputDisabled Global kill-switch state from the gateway.
 */
@Serializable
public data class M0ControlledInputPolicyState(
    public val inputEnabled: Boolean,
    public val globalInputDisabled: Boolean,
)

/**
 * Builds an effective controlled-input policy snapshot from a raw context.
 *
 * @param context Current policy context.
 * @return Effective policy state exposed to consumers.
 */
public fun buildM0ControlledInputPolicyState(
    context: M0ControlledInputPolicyContext,
): M0ControlledInputPolicyState =
    M0ControlledInputPolicyState(
        inputEnabled = context.clientInputEnabled && !context.globalInputDisabled,
        globalInputDisabled = context.globalInputDisabled,
    )

/**
 * Returns true when the policy context allows input to be sent.
 *
 * @param context Current policy context.
 * @return True when input is permitted.
 */
public fun isM0ControlledInputAllowed(context: M0ControlledInputPolicyContext): Boolean =
    context.clientInputEnabled && !context.globalInputDisabled

/**
 * iOS-aligned alias for [M0SessionCapabilities].
 */
public typealias SessionCapabilities = M0SessionCapabilities

/**
 * iOS/server-aligned alias for [M0ControlledInputPolicyContext].
 */
public typealias InputPolicyContext = M0ControlledInputPolicyContext

/**
 * iOS/server-aligned alias for [M0ControlledInputPolicyState].
 */
public typealias InputPolicyState = M0ControlledInputPolicyState

/**
 * iOS/server-aligned alias for [buildM0ControlledInputPolicyState].
 *
 * @param context Current policy context.
 * @return Effective policy state exposed to consumers.
 */
public fun buildInputPolicyState(context: InputPolicyContext): InputPolicyState =
    buildM0ControlledInputPolicyState(context)

/**
 * iOS/server-aligned alias for [isM0ControlledInputAllowed].
 *
 * @param context Current policy context.
 * @return True when input is permitted.
 */
public fun isInputAllowed(context: InputPolicyContext): Boolean =
    isM0ControlledInputAllowed(context)
