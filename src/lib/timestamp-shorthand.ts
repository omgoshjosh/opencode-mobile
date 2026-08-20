// Shorthand timestamps for transcript messages.
//
// The transcript had no per-message times at all — "when did it say that?"
// required leaving for the session list's relative time, which answers a
// different question. The shorthand shows exactly as much calendar as the
// distance requires: today is just a clock, this year adds the date, other
// years spell it fully. 24-hour clock: compact and unambiguous.
//
// Zone: "local" renders in device time; "utc" renders in UTC and SAYS so —
// a bare clock that silently means UTC would read as a wrong local time,
// so the suffix is part of the format, not decoration.
//
// Pure and Intl-free, so it renders identically on Hermes and under
// plain `node --test`.

export type TimeZoneMode = "local" | "utc"

/** How the clock reads: 24-hour ("14:05") or 12-hour ("2:05 PM"). */
export type ClockMode = "24h" | "12h"

export type ClockPreference = "system" | ClockMode

/**
 * Resolve the user's clock preference against the device's own convention.
 * "system" follows the phone (deviceUses24h from the OS locale calendar);
 * an unknown device signal keeps the app's long-standing 24-hour default
 * rather than guessing a region.
 */
export function resolveClockMode(preference: ClockPreference, deviceUses24h: boolean | null | undefined): ClockMode {
  if (preference === "12h" || preference === "24h") return preference
  if (deviceUses24h === false) return "12h"
  return "24h"
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

interface Ymd {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
}

function fields(d: Date, utc: boolean): Ymd {
  return utc
    ? { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hours: d.getUTCHours(), minutes: d.getUTCMinutes() }
    : { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hours: d.getHours(), minutes: d.getMinutes() }
}

function clock(f: Ymd, mode: ClockMode): string {
  const minutes = String(f.minutes).padStart(2, "0")
  if (mode === "12h") {
    // 0 -> 12 AM, 12 -> 12 PM; no leading zero — "8:05 AM", not "08:05 AM".
    const suffix = f.hours < 12 ? "AM" : "PM"
    const hour12 = f.hours % 12 === 0 ? 12 : f.hours % 12
    return `${hour12}:${minutes} ${suffix}`
  }
  return `${String(f.hours).padStart(2, "0")}:${minutes}`
}

/**
 * "14:05" (today) · "Aug 17, 14:05" (this year) · "2025 Aug 17, 14:05";
 * UTC mode appends " UTC". Returns null for missing/invalid input rather
 * than rendering "NaN:NaN".
 */
export function shorthandTimestamp(
  ts: number | null | undefined,
  now: number,
  zone: TimeZoneMode = "local",
  clockMode: ClockMode = "24h",
): string | null {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return null
  const utc = zone === "utc"
  const f = fields(new Date(ts), utc)
  const n = fields(new Date(now), utc)
  const suffix = utc ? " UTC" : ""
  const time = clock(f, clockMode)
  if (f.year === n.year && f.month === n.month && f.day === n.day) return `${time}${suffix}`
  const date = `${MONTHS[f.month]} ${f.day}`
  if (f.year === n.year) return `${date}, ${time}${suffix}`
  return `${f.year} ${date}, ${time}${suffix}`
}
