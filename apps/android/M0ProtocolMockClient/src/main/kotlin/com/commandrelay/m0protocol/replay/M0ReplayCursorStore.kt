package com.commandrelay.m0protocol.replay

/**
 * Store abstraction that tracks the latest acknowledged sequence per stream.
 */
public interface M0ReplayCursorStore {
    /**
     * Returns the latest acknowledged sequence for a stream.
     *
     * @param streamId Stream identifier.
     * @return Stored cursor for the stream, or null when unknown.
     */
    public fun lastSeq(streamId: String): Long?

    /**
     * Records an acknowledged sequence for a stream.
     *
     * Implementations should keep the maximum observed value for each stream.
     *
     * @param streamId Stream identifier.
     * @param seq Sequence to acknowledge.
     */
    public fun record(streamId: String, seq: Long)

    /**
     * Returns a complete cursor snapshot for diagnostics and tests.
     *
     * @return Immutable stream-to-sequence cursor map.
     */
    public fun snapshot(): Map<String, Long>
}

/**
 * In-memory [M0ReplayCursorStore] implementation for tests and local protocol mocks.
 *
 * @param seed Initial stream-to-sequence cursor values.
 */
public class InMemoryM0ReplayCursorStore(seed: Map<String, Long> = emptyMap()) : M0ReplayCursorStore {
    private val cursors: MutableMap<String, Long> = seed.toMutableMap()

    /**
     * Returns the latest acknowledged sequence for [streamId].
     */
    override fun lastSeq(streamId: String): Long? = cursors[streamId]

    /**
     * Records [seq] for [streamId], preserving the maximum value seen.
     */
    override fun record(streamId: String, seq: Long) {
        val current = cursors[streamId] ?: 0L
        cursors[streamId] = maxOf(current, seq)
    }

    /**
     * Returns a detached snapshot so callers cannot mutate internal state.
     */
    override fun snapshot(): Map<String, Long> = cursors.toMap()
}
