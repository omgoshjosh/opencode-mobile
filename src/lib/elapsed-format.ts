// Elapsed time for tool calls — live while running, exact when done.
//
// A finished call reads best with sub-second precision ("412ms", "3.4s"); a
// RUNNING call is a wall clock you're staring at, so past a minute it should
// read like one ("1m 30s", not "90.0s" — nobody divides by sixty while
// waiting on a hung glob).
//
// Pure, so the thresholds are testable under plain `node --test`.

export function formatElapsed(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

/** How often a live timer needs to tick. Sub-second display ends at 60s. */
export const LIVE_TICK_MS = 1000
