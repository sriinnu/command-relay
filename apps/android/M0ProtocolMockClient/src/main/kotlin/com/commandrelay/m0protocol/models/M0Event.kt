package com.commandrelay.m0protocol.models

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * M0 event variants encoded as a discriminator object with `type` and `payload`.
 */
@Serializable(with = M0EventSerializer::class)
public sealed class M0Event {
    /**
     * Stream connection lifecycle event.
     *
     * @property payload Connected event payload.
     */
    public data class Connected(public val payload: M0ConnectedEvent) : M0Event()

    /**
     * Terminal or process output chunk event.
     *
     * @property payload Output chunk payload.
     */
    public data class OutputChunk(public val payload: M0OutputChunkEvent) : M0Event()

    /**
     * Generic status transition event.
     *
     * @property payload Status payload.
     */
    public data class Status(public val payload: M0StatusEvent) : M0Event()

    /**
     * Liveness pulse event.
     *
     * @property payload Heartbeat payload.
     */
    public data class Heartbeat(public val payload: M0HeartbeatEvent) : M0Event()
}

/**
 * Payload for a connection lifecycle event.
 *
 * @property sessionId Server session identifier.
 * @property acceptedLastSeq Last sequence accepted by the server for replay resume.
 */
@Serializable
public data class M0ConnectedEvent(
    @SerialName("session_id")
    public val sessionId: String,
    @SerialName("accepted_last_seq")
    public val acceptedLastSeq: Long? = null,
)

/**
 * Payload containing stream output data.
 *
 * @property chunk Text chunk emitted by the stream.
 * @property isFinal Whether this chunk ends the current output frame.
 */
@Serializable
public data class M0OutputChunkEvent(
    public val chunk: String,
    @SerialName("is_final")
    public val isFinal: Boolean,
)

/**
 * Payload describing a status transition.
 *
 * @property code Machine-readable status code.
 * @property message Human-readable status description.
 */
@Serializable
public data class M0StatusEvent(
    public val code: String,
    public val message: String,
)

/**
 * Payload used to indicate stream liveness.
 *
 * @property serverTimeMs Server epoch timestamp in milliseconds.
 */
@Serializable
public data class M0HeartbeatEvent(
    @SerialName("server_time_ms")
    public val serverTimeMs: Long,
)

internal object M0EventSerializer : KSerializer<M0Event> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("M0Event") {
            element<String>("type")
            element<JsonObject>("payload")
        }

    override fun serialize(encoder: Encoder, value: M0Event) {
        val jsonEncoder = encoder as? JsonEncoder
            ?: throw SerializationException("M0Event can only be serialized by JSON")
        val json = jsonEncoder.json

        val (type, payload) = when (value) {
            is M0Event.Connected -> "connected" to json.encodeToJsonElement(M0ConnectedEvent.serializer(), value.payload)
            is M0Event.OutputChunk -> "output_chunk" to json.encodeToJsonElement(M0OutputChunkEvent.serializer(), value.payload)
            is M0Event.Status -> "status" to json.encodeToJsonElement(M0StatusEvent.serializer(), value.payload)
            is M0Event.Heartbeat -> "heartbeat" to json.encodeToJsonElement(M0HeartbeatEvent.serializer(), value.payload)
        }

        // Keep wire shape aligned with iOS and protocol docs: `{ "type": "...", "payload": { ... } }`.
        jsonEncoder.encodeJsonElement(
            buildJsonObject {
                put("type", JsonPrimitive(type))
                put("payload", payload)
            },
        )
    }

    override fun deserialize(decoder: Decoder): M0Event {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw SerializationException("M0Event can only be deserialized by JSON")
        val root = jsonDecoder.decodeJsonElement().jsonObject
        val type = root["type"]?.jsonPrimitive?.content
            ?: throw SerializationException("Missing event type")
        val payload = root["payload"]
            ?: throw SerializationException("Missing event payload")
        val json = jsonDecoder.json

        return when (type) {
            "connected" -> M0Event.Connected(json.decodeFromJsonElement(M0ConnectedEvent.serializer(), payload))
            "output_chunk" -> M0Event.OutputChunk(json.decodeFromJsonElement(M0OutputChunkEvent.serializer(), payload))
            "status" -> M0Event.Status(json.decodeFromJsonElement(M0StatusEvent.serializer(), payload))
            "heartbeat" -> M0Event.Heartbeat(json.decodeFromJsonElement(M0HeartbeatEvent.serializer(), payload))
            else -> throw SerializationException("Unsupported event type: $type")
        }
    }
}
