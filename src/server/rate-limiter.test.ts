/**
 * @file SlidingWindowRateLimiter behavior tests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

test("consume allows events up to limit then blocks with retry metadata", () => {
  let now = 10_000;
  const limiter = new SlidingWindowRateLimiter({
    maxEvents: 2,
    windowMs: 1_000,
    now: () => now
  });

  const first = limiter.consume("client-a");
  const second = limiter.consume("client-a");
  const blocked = limiter.consume("client-a");

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.limit, 2);
  assert.equal(blocked.windowMs, 1_000);
  assert.equal(blocked.retryAfterMs, 1_000);
  assert.equal(blocked.remaining, 0);
});

test("consume becomes allowed after window passes", () => {
  let now = 20_000;
  const limiter = new SlidingWindowRateLimiter({
    maxEvents: 1,
    windowMs: 1_000,
    now: () => now
  });

  assert.equal(limiter.consume("client-b").allowed, true);
  const blocked = limiter.consume("client-b");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1_000);

  now += 1_001;
  const afterWindow = limiter.consume("client-b");
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.retryAfterMs, 0);
});

test("clear removes key history", () => {
  const limiter = new SlidingWindowRateLimiter({ maxEvents: 1, windowMs: 1_000 });

  assert.equal(limiter.allow("client-c"), true);
  assert.equal(limiter.allow("client-c"), false);

  limiter.clear("client-c");
  assert.equal(limiter.allow("client-c"), true);
});
