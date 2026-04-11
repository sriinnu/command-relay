/**
 * @file Sliding-window rate limiter for per-client message throttling.
 */

/**
 * Sliding window evaluation outcome.
 */
export interface SlidingWindowRateLimitDecision {
  allowed: boolean;
  limit: number;
  windowMs: number;
  retryAfterMs: number;
  remaining: number;
}

/**
 * Sliding-window limiter keyed by client identifier.
 */
export class SlidingWindowRateLimiter {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly timestamps: Map<string, number[]>;

  /**
   * @param options Rate limit options.
   */
  constructor(options: { maxEvents: number; windowMs: number; now?: () => number }) {
    this.maxEvents = options.maxEvents;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;

    this.timestamps = new Map();
  }

  /**
   * Evaluates and consumes one event for a key.
   *
   * @param key Client key.
   * @returns Detailed rate-limit decision.
   */
  consume(key: string): SlidingWindowRateLimitDecision {
    const now = this.now();
    const minTs = now - this.windowMs;
    const history = this.timestamps.get(key) ?? [];

    while (history.length > 0 && history[0] < minTs) {
      history.shift();
    }

    if (history.length >= this.maxEvents) {
      this.timestamps.set(key, history);
      const oldest = history[0] ?? now;
      return {
        allowed: false,
        limit: this.maxEvents,
        windowMs: this.windowMs,
        retryAfterMs: Math.max(0, oldest + this.windowMs - now),
        remaining: 0
      };
    }

    history.push(now);
    this.timestamps.set(key, history);
    return {
      allowed: true,
      limit: this.maxEvents,
      windowMs: this.windowMs,
      retryAfterMs: 0,
      remaining: Math.max(0, this.maxEvents - history.length)
    };
  }

  /**
   * Attempts to consume one event for a key.
   *
   * @param key Client key.
   * @returns True if allowed, false if rate-limited.
   */
  allow(key: string): boolean {
    return this.consume(key).allowed;
  }

  /**
   * Clears state for one key.
   *
   * @param key Client key.
   * @returns Nothing.
   */
  clear(key: string): void {
    this.timestamps.delete(key);
  }
}
