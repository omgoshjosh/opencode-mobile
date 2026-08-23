/**
 * Slow-vs-dead is a distinction the UI could not make: the connection dot
 * reflects SSE liveness only, so a healthy stream plus a molasses REST path
 * showed green while every tap took 10–29 seconds. These pure functions
 * classify recent request durations so the UI can say "slow" before the 30s
 * timeout says "dead".
 *
 * Sampling happens in the SDK's fetch wrapper (success, failure and timeout
 * all count — a timeout IS a latency observation; a user-initiated abort is
 * not). The classifier only sees {when, how long}.
 */

/** A single request's duration is suspicious past this. */
export const SLOW_REQUEST_MS = 2_500
/** One request this slow flags immediately — no quorum needed. */
export const VERY_SLOW_REQUEST_MS = 8_000
/** Samples older than this stop influencing the verdict. */
export const LATENCY_WINDOW_MS = 60_000
/** Ring-buffer cap; enough for a burst without unbounded growth. */
export const MAX_SAMPLES = 20

export interface LatencySample {
  at: number
  ms: number
}

export function recordSample(samples: LatencySample[], ms: number, at: number): LatencySample[] {
  return [...samples, { at, ms }].filter((s) => at - s.at <= LATENCY_WINDOW_MS).slice(-MAX_SAMPLES)
}

/**
 * Slow when the recent evidence says so:
 * - any in-window sample past VERY_SLOW (includes timeouts), or
 * - at least two in-window samples whose median exceeds SLOW.
 * A single mildly-slow request never flags — one 3s call is noise, a pattern
 * of them is a verdict. Recovery is automatic: fast samples pull the median
 * down, and old evidence ages out of the window entirely.
 */
export function isRestSlow(samples: LatencySample[], now: number): boolean {
  const recent = samples.filter((s) => now - s.at <= LATENCY_WINDOW_MS)
  if (recent.length === 0) return false
  if (recent.some((s) => s.ms >= VERY_SLOW_REQUEST_MS)) return true
  if (recent.length < 2) return false
  const sorted = recent.map((s) => s.ms).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return median > SLOW_REQUEST_MS
}
