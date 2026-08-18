// Shorthand timestamps for transcript messages.
//
// The transcript had no per-message times at all — "when did it say that?"
// required leaving for the session list's relative time, which answers a
// different question. The shorthand shows exactly as much calendar as the
// distance requires: today is just a clock, this year adds the date, other
// years spell it fully. 24-hour clock: compact and unambiguous.
//
// Pure and Intl-free, so it renders identically on Hermes and under
// plain `node --test`.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * "14:05" (today) · "Aug 17, 14:05" (this year) · "2025 Aug 17, 14:05".
 * Returns null for missing/invalid input rather than rendering "NaN:NaN".
 */
export function shorthandTimestamp(ts: number | null | undefined, now: number): string | null {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return null
  const d = new Date(ts)
  const n = new Date(now)
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  if (sameDay) return clock(d)
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  if (d.getFullYear() === n.getFullYear()) return `${date}, ${clock(d)}`
  return `${d.getFullYear()} ${date}, ${clock(d)}`
}
