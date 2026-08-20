// Does the DEVICE prefer a 24-hour clock? Thin runtime wrapper (not under
// node --test — it imports expo). Read once and cached: the OS setting
// changes rarely and never mid-session in practice.
import { getCalendars } from "expo-localization"

let cached: boolean | null | undefined

export function deviceUses24hClock(): boolean | null {
  if (cached !== undefined) return cached
  try {
    cached = getCalendars()[0]?.uses24hourClock ?? null
  } catch {
    cached = null
  }
  return cached
}
