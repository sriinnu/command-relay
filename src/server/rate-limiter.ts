/**
 * @file Sliding-window rate limiter for per-client message throttling.
 */

/**
 * Sliding-window limiter keyed by client identifier.
 */
export class SlidingWindowRateLimiter {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private readonly timestamps: Map<string, number[]>;

  /**
   * @param options Rate limit options.
   */
  constructor(options: { maxEvents: number; windowMs: number }) {
    this.maxEvents = options.maxEvents;
    this.windowMs = options.windowMs;

    this.timestamps = new Map();
  }

  /**
   * Attempts to consume one event for a key.
   *
   * @param key Client key.
   * @returns True if allowed, false if rate-limited.
   */
  allow(key: string): boolean {
    const now = Date.now();
    const minTs = now - this.windowMs;
    const history = this.timestamps.get(key) ?? [];

    while (history.length > 0 && history[0] < minTs) {
      history.shift();
    }

    if (history.length >= this.maxEvents) {
      this.timestamps.set(key, history);
      return false;
    }

    history.push(now);
    this.timestamps.set(key, history);
    return true;
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
