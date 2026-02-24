package com.commandrelay.m0protocol

import com.commandrelay.m0protocol.replay.InMemoryM0ReplayCursorStore
import kotlin.test.Test
import kotlin.test.assertEquals

class M0ReplayCursorStoreTest {
    @Test
    fun recordKeepsMaximumCursorPerStream() {
        val store = InMemoryM0ReplayCursorStore(seed = mapOf("stream-1" to 2L))

        store.record(streamId = "stream-1", seq = 1L)
        store.record(streamId = "stream-1", seq = 5L)
        store.record(streamId = "stream-1", seq = 4L)

        assertEquals(5L, store.lastSeq("stream-1"))
    }

    @Test
    fun snapshotReturnsIndependentView() {
        val store = InMemoryM0ReplayCursorStore()
        store.record(streamId = "stream-1", seq = 1L)

        val snapshot = store.snapshot()
        store.record(streamId = "stream-1", seq = 2L)

        assertEquals(1L, snapshot["stream-1"])
        assertEquals(2L, store.lastSeq("stream-1"))
    }
}
