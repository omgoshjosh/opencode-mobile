/**
 * The time-zone picker's data: which zones to offer and how to search them.
 *
 * Intl.supportedValuesOf("timeZone") is the real list when the runtime has
 * it (Node does; Hermes builds vary) — the curated list below is the
 * fallback, chosen to cover a farm operator's realistic needs (major hubs
 * on every continent) rather than all ~420 IANA entries. Search always
 * runs over whichever list is live.
 */

export const FALLBACK_ZONES: string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Pacific/Auckland",
]

/** The zones the picker offers, best list the runtime can produce. */
export function availableZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    const zones = intl.supportedValuesOf?.("timeZone")
    if (Array.isArray(zones) && zones.length > 0) return zones
  } catch {
    // Fall through to the curated list.
  }
  return FALLBACK_ZONES
}

/** "America/Los_Angeles" -> "Los Angeles · America" — city first, searchable both ways. */
export function zoneDisplayLabel(zone: string): string {
  const segments = zone.split("/")
  const city = (segments[segments.length - 1] ?? zone).replace(/_/g, " ")
  const region = segments.length > 1 ? segments[0].replace(/_/g, " ") : ""
  return region ? `${city} · ${region}` : city
}

/** Case-insensitive substring match over the raw name and its display form. */
export function filterZones(zones: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return zones
  return zones.filter(
    (zone) => zone.toLowerCase().includes(q) || zoneDisplayLabel(zone).toLowerCase().includes(q),
  )
}
