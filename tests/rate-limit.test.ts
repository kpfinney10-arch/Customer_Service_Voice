import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRateLimiterFromEnv,
  InMemoryRateLimiter,
  RateLimitConfigError,
} from "../src/security/rate-limit.js";

test("in-memory rate limiter allows requests until the fixed window limit is reached", () => {
  let now = 1_000;
  const limiter = new InMemoryRateLimiter({
    limit: 2,
    windowMs: 1_000,
    now: () => now,
  });

  const first = limiter.check({ key: "tenant-a", method: "GET", path: "/v1/tenants/tenant-a/config" });
  const second = limiter.check({ key: "tenant-a", method: "GET", path: "/v1/tenants/tenant-a/config" });
  const third = limiter.check({ key: "tenant-a", method: "GET", path: "/v1/tenants/tenant-a/config" });

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds, 1);

  now = 2_001;
  const afterReset = limiter.check({ key: "tenant-a", method: "GET", path: "/v1/tenants/tenant-a/config" });

  assert.equal(afterReset.allowed, true);
  assert.equal(afterReset.remaining, 1);
});

test("in-memory rate limiter isolates tenants and routes", () => {
  const limiter = new InMemoryRateLimiter({
    limit: 1,
    windowMs: 1_000,
    now: () => 1_000,
  });

  assert.equal(limiter.check({ key: "tenant-a", method: "GET", path: "/config" }).allowed, true);
  assert.equal(limiter.check({ key: "tenant-b", method: "GET", path: "/config" }).allowed, true);
  assert.equal(limiter.check({ key: "tenant-a", method: "POST", path: "/config" }).allowed, true);
  assert.equal(limiter.check({ key: "tenant-a", method: "GET", path: "/config" }).allowed, false);
});

test("rate limiter env factory uses configured limit and window", () => {
  const limiter = createRateLimiterFromEnv({
    limit: "1",
    windowMs: "2500",
  });

  const first = limiter.check({ key: "tenant-a", method: "GET", path: "/config" });
  const second = limiter.check({ key: "tenant-a", method: "GET", path: "/config" });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.limit, 1);
  assert.equal(second.retryAfterSeconds, 3);
});

test("rate limiter env factory rejects invalid values", () => {
  assert.throws(
    () =>
      createRateLimiterFromEnv({
        limit: "0",
        windowMs: "60000",
      }),
    RateLimitConfigError,
  );
  assert.throws(
    () =>
      createRateLimiterFromEnv({
        limit: "10",
        windowMs: "not-a-number",
      }),
    RateLimitConfigError,
  );
});
