package com.commandrelay.m0protocol.models

import kotlinx.serialization.Serializable

/**
 * Basic terminal session metadata for list rendering.
 *
 * Mirrors the iOS `RelaySessionSummary` domain shape.
 *
 * @property id Stable session identifier.
 * @property title Human-readable session name.
 * @property host Host label shown in list subtitles.
 * @property readOnly Whether this session currently allows input.
 */
@Serializable
public data class M0RelaySessionSummary(
    public val id: String,
    public val title: String,
    public val host: String,
    public val readOnly: Boolean,
)

/**
 * Input model for session list queries.
 *
 * Mirrors iOS defaults: empty search text and archived sessions excluded.
 *
 * @property searchText Optional search text filter.
 * @property includeArchived Includes archived sessions when true.
 */
@Serializable
public data class M0SessionListQuery(
    public val searchText: String = "",
    public val includeArchived: Boolean = false,
)

/**
 * iOS-aligned alias for [M0RelaySessionSummary].
 */
public typealias RelaySessionSummary = M0RelaySessionSummary

/**
 * iOS-aligned alias for [M0SessionListQuery].
 */
public typealias SessionListQuery = M0SessionListQuery
