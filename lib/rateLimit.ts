// lib/rateLimit.ts
// In-memory sliding window rate limiter.
// Sufficient for single-instance dev and early production.
// Replace with Redis-backed limiter when scaling to multiple instances.

type WindowEntry = {
  timestamps: number[];
};

const store = new Map<string, WindowEntry>();

type RateLimitConfig = {
  windowMs: number; // window size in milliseconds
  maxRequests: number; // max requests allowed per window
};

export const RATE_LIMITS = {
  registration:  { windowMs: 10 * 60 * 1000, maxRequests: 5  },
  presign:       { windowMs:  5 * 60 * 1000, maxRequests: 20 },
  studentUpload: { windowMs:  5 * 60 * 1000, maxRequests: 10 },
  adminUpload:   { windowMs:  5 * 60 * 1000, maxRequests: 30 },
  // Login limits — applied per IP before any DB or bcrypt work.
  // Student: generous enough for a child mistyping their password.
  // Admin: tighter — fewer expected attempts, higher value target.
  studentLogin:  { windowMs: 15 * 60 * 1000, maxRequests: 10 },
  adminLogin:    { windowMs: 15 * 60 * 1000, maxRequests: 5  },
} satisfies Record<string, RateLimitConfig>;

/**
 * Format a retryAfterMs value into a human-readable string.
 * Used in login route 429 responses so users see a clear wait time.
 * Examples: "less than a minute", "2 minutes", "14 minutes"
 */
export function formatRetryAfter(retryAfterMs: number): string {
  const seconds = Math.ceil(retryAfterMs / 1000);
  if (seconds < 60) return "less than a minute";
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Check and record a request for a given key.
 * Returns { allowed: true } or { allowed: false, retryAfterMs: number }
 *
 * In development, rate limiting is disabled entirely to avoid false
 * positives caused by all requests sharing the "unknown" IP key on
 * localhost (no x-forwarded-for header in local dev).
 */
export function rateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  // Disable in development — all localhost requests share "unknown" IP
  // which causes the limit to exhaust rapidly during testing.
  if (process.env.NODE_ENV === "development") {
    return { allowed: true };
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Evict timestamps outside current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    // Oldest timestamp in window tells us when a slot frees up
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    console.warn(`[rateLimit] key=${key} limit=${config.maxRequests} retryAfterMs=${retryAfterMs}`);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

/**
 * Extract the real client IP from Next.js request headers.
 * Falls back to "unknown" if not determinable.
 */
export function getClientIp(req: Request): string {
  const headers = req.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}