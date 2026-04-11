package com.commandrelay.m0protocol.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Strongly typed M0 envelope carrying ordered stream metadata and a protocol payload.
 *
 * @property streamId Stable stream identifier used to group ordered events.
 * @property streamSeq Monotonic sequence number for this stream event.
 * @property lastSeq Optional receiver cursor reported by the sender at emit time.
 * @property sentAtMs Unix epoch timestamp in milliseconds when this envelope was produced.
 * @property event Typed event payload contained by this envelope.
 */
@Serializable
public data class M0Envelope<Payload>(
    @SerialName("stream_id")
    public val streamId: String,
    @SerialName("stream_seq")
    public val streamSeq: Long,
    @SerialName("last_seq")
    public val lastSeq: Long? = null,
    @SerialName("sent_at_ms")
    public val sentAtMs: Long,
    public val event: Payload,
)
