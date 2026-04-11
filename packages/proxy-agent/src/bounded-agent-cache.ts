/**
 * Default maximum number of cached proxy agents.
 */
export const DEFAULT_CACHE_ENTRIES = 256;

/**
 * Normalizes a max-cache-entries input into a safe integer.
 *
 * @param value Raw max entries value.
 * @returns Safe integer max entries.
 */
export function normalizeCacheEntries(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CACHE_ENTRIES;
  }
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_CACHE_ENTRIES;
  }
  const normalized = Math.floor(value);
  if (!Number.isSafeInteger(normalized)) {
    return DEFAULT_CACHE_ENTRIES;
  }
  return normalized;
}

/**
 * Small bounded LRU-style cache backed by `Map`.
 */
export class BoundedAgentCache<K, V> {
  private readonly store = new Map<K, V>();
  private readonly maxEntries: number;
  private readonly onEvict: ((value: V) => void) | undefined;

  /**
   * @param maxEntries Maximum entry count.
   * @param onEvict Optional callback for evicted/cleared values.
   */
  constructor(maxEntries: number, onEvict?: (value: V) => void) {
    this.maxEntries = maxEntries;
    this.onEvict = onEvict;
  }

  /**
   * Current number of items in cache.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clears all cache entries.
   */
  clear(): void {
    for (const value of this.store.values()) {
      this.onEvict?.(value);
    }
    this.store.clear();
  }

  /**
   * Gets a value and refreshes its recency.
   *
   * @param key Cache key.
   * @returns Cached value or `null`.
   */
  get(key: K): V | null {
    const value = this.store.get(key);
    if (value === undefined) {
      return null;
    }
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  /**
   * Sets a value and evicts least-recently-used entries when needed.
   *
   * @param key Cache key.
   * @param value Cache value.
   */
  set(key: K, value: V): void {
    if (this.maxEntries === 0) {
      return;
    }
    if (this.store.has(key)) {
      const prior = this.store.get(key) as V;
      this.store.delete(key);
      if (prior !== value) {
        this.onEvict?.(prior);
      }
    }
    this.store.set(key, value);
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        break;
      }
      const oldestValue = this.store.get(oldestKey) as V;
      this.store.delete(oldestKey);
      this.onEvict?.(oldestValue);
    }
  }
}
