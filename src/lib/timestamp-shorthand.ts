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
// so the suffix is part of the format, not decoration. The same honesty
// rule extends to specific zones: an IANA zone renders via Intl and carries
// that zone's own short label ("PDT"), and a zone Intl can't resolve falls
// back to UTC WITH the UTC suffix — a mislabeled clock is worse than a
// differently-zoned one that says what it is.
//
// local/utc stay Intl-free (identical on Hermes and plain `node --test`);
// specific zones use Intl.DateTimeFormat, which both runtimes ship.

/** "local" | "utc" | an IANA zone name ("America/Los_Angeles"). */
export type TimeZoneMode = "local" | "utc" | (string & {})

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

/** True when the mode names a specific IANA zone rather than local/utc. */
export function isSpecificZone(zone: TimeZoneMode | null | undefined): boolean {
  return typeof zone === "string" && zone !== "local" && zone !== "utc"
}

/** Is this a zone Intl can actually render? Gate at selection time so an
 *  unloadable zone is never persisted in the first place. */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

interface ZoneFields extends Ymd {
  /** The zone's own short label for the suffix — "PDT", "GMT+2". */
  label: string
}

// Per-zone formatters are surprisingly expensive to construct; the transcript
// renders hundreds of timestamps in one zone, so cache by zone name.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFields(d: Date, zone: string): ZoneFields | null {
  try {
    let formatter = zoneFormatters.get(zone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
        timeZoneName: "short",
      })
      zoneFormatters.set(zone, formatter)
    }
    const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
    for (const part of formatter.formatToParts(d)) parts[part.type] = part.value
    const year = Number(parts.year)
    const month = Number(parts.month) - 1
    const day = Number(parts.day)
    const hours = Number(parts.hour)
    const minutes = Number(parts.minute)
    if ([year, month, day, hours, minutes].some((n) => !Number.isFinite(n))) return null
    return { year, month, day, hours, minutes, label: parts.timeZoneName || zone }
  } catch {
    return null
  }
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
  let f: Ymd
  let n: Ymd
  let suffix: string
  const specific = isSpecificZone(zone) ? zoneFields(new Date(ts), zone) : null
  if (specific) {
    f = specific
    // `now` resolved in the same zone so "today" collapses correctly there.
    n = zoneFields(new Date(now), zone) ?? fields(new Date(now), true)
    suffix = ` ${specific.label}`
  } else {
    // local, utc — or a specific zone Intl couldn't resolve, which falls
    // back to UTC *with its suffix*: differently-zoned but never mislabeled.
    const utc = zone !== "local"
    f = fields(new Date(ts), utc)
    n = fields(new Date(now), utc)
    suffix = utc ? " UTC" : ""
  }
  const time = clock(f, clockMode)
  if (f.year === n.year && f.month === n.month && f.day === n.day) return `${time}${suffix}`
  const date = `${MONTHS[f.month]} ${f.day}`
  if (f.year === n.year) return `${date}, ${time}${suffix}`
  return `${f.year} ${date}, ${time}${suffix}`
}
