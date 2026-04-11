package com.commandrelay.m0protocol

import com.commandrelay.m0protocol.models.M0Envelope
import com.commandrelay.m0protocol.models.M0Event
import com.commandrelay.m0protocol.models.M0StatusEvent
import com.commandrelay.m0protocol.replay.M0ReplayPlanner
import kotlin.test.Test
import kotlin.test.assertEquals

class M0ReplayPlannerTest {
    private val planner = M0ReplayPlanner()

    @Test
    fun replayPlannerReturnsOnlyEventsAfterLastSeqInOrder() {
        val backlog = listOf(5L, 2L, 4L, 1L, 3L).map { seq ->
            M0Envelope(
                streamId = "stream-1",
                streamSeq = seq,
                lastSeq = null,
                sentAtMs = seq,
                event = M0Event.Status(M0StatusEvent(code = "SEQ", message = "$seq")),
            )
        }

        val replay = planner.replayEvents(backlog = backlog, lastSeq = 3L)

        assertEquals(listOf(4L, 5L), replay.map { it.streamSeq })
    }

    @Test
    fun makeResumeRequestBuildsExpectedFields() {
        val request = planner.makeResumeRequest(streamId = "stream-1", streamSeq = 5L, lastSeq = 2L)

        assertEquals("stream-1", request.streamId)
        assertEquals(5L, request.streamSeq)
        assertEquals(2L, request.lastSeq)
    }
}
