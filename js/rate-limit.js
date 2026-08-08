/**
 * Simple sliding-window rate limiter for Open Food Facts.
 * Search: ~10/min · Product reads: ~15/min (per IP).
 */

export class RateLimiter {
  /**
   * @param {number} maxRequests
   * @param {number} windowMs
   */
  constructor(maxRequests, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    /** @type {number[]} */
    this.timestamps = [];
  }

  /** Milliseconds until a slot opens, or 0 if allowed now. */
  waitMs() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length < this.maxRequests) return 0;
    const oldest = this.timestamps[0];
    return Math.max(0, this.windowMs - (now - oldest) + 50);
  }

  canProceed() {
    return this.waitMs() === 0;
  }

  record() {
    this.timestamps.push(Date.now());
  }

  /** Human-readable seconds remaining. */
  waitSeconds() {
    return Math.ceil(this.waitMs() / 1000);
  }
}

export const searchLimiter = new RateLimiter(10, 60_000);
export const productLimiter = new RateLimiter(15, 60_000);
