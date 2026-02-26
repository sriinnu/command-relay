package com.commandrelay.m0protocol.replay

import com.commandrelay.m0protocol.models.M0Envelope
import com.commandrelay.m0protocol.models.M0Event
import com.commandrelay.m0protocol.models.M0ResumeRequest

/**
 * Computes replay windows and reconnect metadata from `streamSeq` and `lastSeq`.
 */
public class M0ReplayPlanner {
    /**
     * Builds a reconnect resume request for a known stream and cursor.
     *
     * @param streamId Stream being resumed.
     * @param streamSeq Sequence value to use for the reconnect request.
     * @param lastSeq Last processed sequence tracked by the client.
     * @return Resume request for reconnect.
     */
    public fun makeResumeRequest(streamId: String, streamSeq: Long, lastSeq: Long): M0ResumeRequest =
        M0ResumeRequest(
            streamId = streamId,
            streamSeq = streamSeq,
            lastSeq = lastSeq,
        )

    /**
     * Filters and orders events that should be replayed after reconnect.
     *
     * @param backlog Full stream backlog from the mock transport.
     * @param lastSeq Last processed sequence from the reconnecting client.
     * @return Ordered events with sequence strictly greater than [lastSeq].
     */
    public fun replayEvents(
        backlog: List<M0Envelope<M0Event>>,
        lastSeq: Long,
    ): List<M0Envelope<M0Event>> =
        backlog
            .asSequence()
            .filter { it.streamSeq > lastSeq }
            .sortedBy { it.streamSeq }
            .toList()
}
