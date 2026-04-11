package com.commandrelay.m0protocol

import com.commandrelay.m0protocol.models.M0Envelope
import com.commandrelay.m0protocol.models.M0Event
import com.commandrelay.m0protocol.models.M0OutputChunkEvent
import com.commandrelay.m0protocol.models.M0ResumeRequest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class M0EventEnvelopeTest {
    private val json: Json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    @Test
    fun envelopeRoundTripEncodingPreservesTypedPayload() {
        val envelope = M0Envelope(
            streamId = "stream-1",
            streamSeq = 42L,
            lastSeq = 41L,
            sentAtMs = 1_707_000_000_000L,
            event = M0Event.OutputChunk(M0OutputChunkEvent(chunk = "hello", isFinal = true)),
        )

        val encoded = json.encodeToString(M0Envelope.serializer(M0Event.serializer()), envelope)
        val decoded = json.decodeFromString(M0Envelope.serializer(M0Event.serializer()), encoded)

        assertEquals(envelope, decoded)
    }

    @Test
    fun eventUsesDiscriminatorPayloadWireShape() {
        val event = M0Event.OutputChunk(M0OutputChunkEvent(chunk = "hello", isFinal = true))

        val encoded = json.encodeToString(M0Event.serializer(), event)

        assertTrue(encoded.contains("\"type\":\"output_chunk\""))
        assertTrue(encoded.contains("\"payload\""))
        assertTrue(encoded.contains("\"is_final\":true"))
    }

    @Test
    fun resumeRequestUsesSnakeCaseJsonKeys() {
        val request = M0ResumeRequest(streamId = "stream-1", streamSeq = 11L, lastSeq = 10L)
        val encoded = json.encodeToString(M0ResumeRequest.serializer(), request)

        assertTrue(encoded.contains("\"stream_id\""))
        assertTrue(encoded.contains("\"stream_seq\""))
        assertTrue(encoded.contains("\"last_seq\""))
    }
}
