import Foundation

/// Exponential reconnect delay policy with optional jitter.
public struct M0ReconnectBackoffPolicy: Sendable {
    /// Initial reconnect delay in milliseconds.
    public let initialDelayMs: UInt64

    /// Exponential growth multiplier applied per retry attempt.
    public let multiplier: Double

    /// Maximum reconnect delay in milliseconds.
    public let maxDelayMs: UInt64

    /// Jitter ratio applied around each base delay, from `0.0` to `1.0`.
    public let jitterRatio: Double

    /// Creates a reconnect policy.
    /// - Parameters:
    ///   - initialDelayMs: Delay for attempt `0`.
    ///   - multiplier: Exponential growth multiplier.
    ///   - maxDelayMs: Upper cap for computed delays.
    ///   - jitterRatio: Optional jitter spread ratio from 0 to 1.
    public init(
        initialDelayMs: UInt64 = 250,
        multiplier: Double = 2.0,
        maxDelayMs: UInt64 = 10_000,
        jitterRatio: Double = 0.2
    ) {
        precondition(initialDelayMs > 0, "initialDelayMs must be greater than zero.")
        precondition(multiplier >= 1.0, "multiplier must be greater than or equal to one.")
        precondition(maxDelayMs >= initialDelayMs, "maxDelayMs must be greater than or equal to initialDelayMs.")
        precondition((0...1).contains(jitterRatio), "jitterRatio must be between 0 and 1.")

        self.initialDelayMs = initialDelayMs
        self.multiplier = multiplier
        self.maxDelayMs = maxDelayMs
        self.jitterRatio = jitterRatio
    }

    /// Computes delay for a reconnect attempt.
    /// - Parameters:
    ///   - attempt: Zero-based reconnect attempt.
    ///   - randomUnit: Random value in `[0, 1]` used for jitter sampling.
    /// - Returns: Delay in milliseconds.
    public func delayMilliseconds(forAttempt attempt: Int, randomUnit: Double = 0.5) -> UInt64 {
        let clampedAttempt = max(attempt, 0)
        let exponent = pow(multiplier, Double(clampedAttempt))
        let baseDelay = min(Double(maxDelayMs), Double(initialDelayMs) * exponent)

        let jitterSpan = baseDelay * jitterRatio
        let lowerBound = max(0, baseDelay - jitterSpan)
        let upperBound = min(Double(maxDelayMs), baseDelay + jitterSpan)

        let clampedRandom = min(max(randomUnit, 0), 1)
        let sampledDelay = lowerBound + (upperBound - lowerBound) * clampedRandom
        return UInt64(sampledDelay.rounded())
    }

    /// Computes delay for a reconnect attempt in nanoseconds.
    /// - Parameters:
    ///   - attempt: Zero-based reconnect attempt.
    ///   - randomUnit: Random value in `[0, 1]` used for jitter sampling.
    /// - Returns: Delay in nanoseconds.
    public func delayNanoseconds(forAttempt attempt: Int, randomUnit: Double = 0.5) -> UInt64 {
        let milliseconds = delayMilliseconds(forAttempt: attempt, randomUnit: randomUnit)
        let (nanoseconds, overflow) = milliseconds.multipliedReportingOverflow(by: 1_000_000)
        return overflow ? UInt64.max : nanoseconds
    }
}
