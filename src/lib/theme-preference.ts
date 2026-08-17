// The dark-mode override setting.
//
// The app followed the OS theme only — the answer to "how do I turn on dark
// mode?" was "leave the app and change your system settings", which is not a
// setting, it's an excuse. The preference below feeds RN's
// Appearance.setColorScheme(), which every existing useColorScheme() call
// site already listens to — so one applied value re-themes all 40 screens
// with no per-screen changes.
//
// Pure, so the resolution rule is testable under plain `node --test`.

export type ThemePreference = "system" | "light" | "dark"

export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"]

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark"
}

/**
 * The value for Appearance.setColorScheme(): an explicit scheme forces it,
 * "system" (or anything unrecognised from older stored settings) clears the
 * override so the OS decides again.
 */
export function resolveColorScheme(preference: unknown): "light" | "dark" | null {
  return preference === "light" || preference === "dark" ? preference : null
}
