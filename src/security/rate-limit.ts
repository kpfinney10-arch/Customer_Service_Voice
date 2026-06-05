export type RateLimitInput = {
  key: string;
  method: string;
  path: string;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds?: number;
};

export type RateLimiter = {
  check: (input: RateLimitInput) => RateLimitDecision;
};

export type InMemoryRateLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAtMs: number }>();
  private readonly now: () => number;

  constructor(private readonly options: InMemoryRateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  check(input: RateLimitInput): RateLimitDecision {
    const nowMs = this.now();
    const bucketKey = `${input.key}:${input.method}:${input.path}`;
    const existing = this.buckets.get(bucketKey);
    const bucket =
      existing && existing.resetAtMs > nowMs
        ? existing
        : {
            count: 0,
            resetAtMs: nowMs + this.options.windowMs,
          };

    if (bucket.count >= this.options.limit) {
      this.buckets.set(bucketKey, bucket);
      return {
        allowed: false,
        limit: this.options.limit,
        remaining: 0,
        resetAt: new Date(bucket.resetAtMs).toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
      };
    }

    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);
    return {
      allowed: true,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - bucket.count),
      resetAt: new Date(bucket.resetAtMs).toISOString(),
    };
  }
}

export function createDefaultRateLimiter(): RateLimiter {
  return new InMemoryRateLimiter({
    limit: 120,
    windowMs: 60_000,
  });
}
