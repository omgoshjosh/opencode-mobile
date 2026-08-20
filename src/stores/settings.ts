import { create } from "zustand"
import { Appearance } from "react-native"
import * as SecureStore from "expo-secure-store"
import { type Category, defaultPreferences } from "../lib/notifications"
import { clampPageSize, mergeStoredSettings } from "../lib/settings-merge"
import { setAppLocale } from "../lib/i18n/config"
import type { LocalePreference } from "../lib/i18n/locale-resolve"
import { resolveColorScheme, type ThemePreference } from "../lib/theme-preference"
import type { ClockPreference, TimeZoneMode } from "../lib/timestamp-shorthand"

const SETTINGS_KEY = "opencode_settings"

interface Settings {
  pageSize: number
  notifications: Record<Category, boolean>
  locale: LocalePreference
  theme: ThemePreference
  /** Experiment: triage-first sessions list. Off = the classic list. */
  sessionsListV2: boolean
  /** Timestamp rendering: device-local time or UTC. */
  timeZone: TimeZoneMode
  /** 12-hour vs 24-hour clock; "system" follows the phone's own setting. */
  clock: ClockPreference
}

const DEFAULTS: Settings = {
  pageSize: 25,
  notifications: { ...defaultPreferences },
  locale: "system",
  theme: "system",
  sessionsListV2: false,
  timeZone: "local",
  clock: "system",
}

interface SettingsState extends Settings {
  loaded: boolean
  load: () => Promise<void>
  setPageSize: (size: number) => Promise<void>
  setNotification: (category: Category, enabled: boolean) => Promise<void>
  setLocale: (locale: LocalePreference) => Promise<void>
  setTheme: (theme: ThemePreference) => Promise<void>
  setSessionsListV2: (enabled: boolean) => Promise<void>
  setTimeZone: (zone: TimeZoneMode) => Promise<void>
  setClock: (clock: ClockPreference) => Promise<void>
}

function snapshot(get: () => SettingsState): Settings {
  return {
    pageSize: get().pageSize,
    notifications: get().notifications,
    locale: get().locale,
    theme: get().theme,
    sessionsListV2: get().sessionsListV2,
    timeZone: get().timeZone,
    clock: get().clock,
  }
}

/** Every useColorScheme() call site in the app follows this one call. */
function applyTheme(theme: ThemePreference) {
  Appearance.setColorScheme(resolveColorScheme(theme))
}

async function persist(settings: Settings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings))
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      // Merge stored settings with defaults so new fields/categories get their default
      const merged = mergeStoredSettings(DEFAULTS, parsed)
      set({ ...merged, loaded: true })
      setAppLocale(merged.locale)
      applyTheme(merged.theme)
      return
    }
    set({ loaded: true })
  },

  setPageSize: async (size) => {
    const clamped = clampPageSize(size)
    set({ pageSize: clamped })
    await persist({ ...snapshot(get), pageSize: clamped })
  },

  setNotification: async (category, enabled) => {
    const notifications = { ...get().notifications, [category]: enabled }
    set({ notifications })
    await persist({ ...snapshot(get), notifications })
  },

  setLocale: async (locale) => {
    set({ locale })
    setAppLocale(locale) // applies immediately
    await persist({ ...snapshot(get), locale })
  },

  setTheme: async (theme) => {
    set({ theme })
    applyTheme(theme) // applies immediately
    await persist({ ...snapshot(get), theme })
  },

  setSessionsListV2: async (sessionsListV2) => {
    set({ sessionsListV2 })
    await persist({ ...snapshot(get), sessionsListV2 })
  },

  setTimeZone: async (timeZone) => {
    set({ timeZone })
    await persist({ ...snapshot(get), timeZone })
  },

  setClock: async (clock) => {
    set({ clock })
    await persist({ ...snapshot(get), clock })
  },
}))
