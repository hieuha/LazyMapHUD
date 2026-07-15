// Small in-memory per-key sliding-window rate limiter — used by the open
// /chaser route (no auth, so this is the only abuse guard) to bound how
// often a single IP can post. Not distributed/shared across processes;
// fine for the trusted-network, single-instance deployment this endpoint
// targets (see chaser-route.ts header comment).
interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if `key` is still within its allowance; increments the counter either way. */
  allow(key: string): boolean {
    const now = Date.now();
    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    existing.count += 1;
    return existing.count <= this.maxPerWindow;
  }

  /** Drop expired windows — call periodically to bound memory for long-lived processes. */
  sweep(): void {
    const now = Date.now();
    for (const [key, window] of this.hits) {
      if (window.resetAt <= now) this.hits.delete(key);
    }
  }
}
