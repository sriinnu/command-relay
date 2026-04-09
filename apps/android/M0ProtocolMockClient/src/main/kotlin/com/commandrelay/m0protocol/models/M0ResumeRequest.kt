package com.commandrelay.m0protocol.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Metadata used to reconnect and replay from a known stream cursor.
 *
 * @property streamId Identifier of the stream that should be resumed.
 * @property streamSeq Sender sequence value for the reconnect request itself.
 * @property lastSeq Last sequence already processed by the reconnecting client.
 */
@Serializable
public data class M0ResumeRequest(
    @SerialName("stream_id")
    public val streamId: String,
    @SerialName("stream_seq")
    public val streamSeq: Long,
    @SerialName("last_seq")
    public val lastSeq: Long,
)
