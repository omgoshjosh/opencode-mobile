import { mock } from "node:test"

const storage = new Map()
const memoryStore = {
  getItem: async (key) => storage.get(key) ?? null,
  setItem: async (key, value) => void storage.set(key, value),
  removeItem: async (key) => void storage.delete(key),
  clear: async () => void storage.clear(),
}

mock.module("react-native", {
  namedExports: {
    Platform: { OS: "ios", select: (values) => values.ios ?? values.default },
    Appearance: { setColorScheme: () => {} },
    AppState: { currentState: "active" },
  },
})
mock.module("@react-native-async-storage/async-storage", { defaultExport: memoryStore })
mock.module("expo/fetch", { namedExports: { fetch: globalThis.fetch } })
mock.module("expo-application", { namedExports: { nativeApplicationVersion: "0.0.0", nativeBuildVersion: "0" } })
mock.module("expo-secure-store", { namedExports: { ...memoryStore } })
mock.module("expo-crypto", { namedExports: { randomUUID: () => "test-uuid" } })
mock.module("expo-notifications", {
  namedExports: {
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: () => {},
    getPermissionsAsync: async () => ({ status: "denied" }),
    requestPermissionsAsync: async () => ({ status: "denied" }),
    setNotificationChannelAsync: async () => {},
    scheduleNotificationAsync: async () => {},
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  },
})
mock.module("expo-device", { namedExports: { isDevice: false } })
mock.module("expo-localization", { namedExports: { getLocales: () => [{ languageTag: "en-US" }] } })
mock.module("expo-store-review", { namedExports: { isAvailableAsync: async () => false, requestReview: async () => {} } })
mock.module("@sentry/react-native", { namedExports: { addBreadcrumb: () => {}, captureException: () => {} } })
mock.module("posthog-react-native", {
  defaultExport: class PostHog {
    fetch() { return Promise.resolve({ status: 200 }) }
    optIn() { return Promise.resolve() }
    optOut() { return Promise.resolve() }
    shutdown() { return Promise.resolve() }
    capture() {}
  },
})

export function clearNativeMockStorage() {
  storage.clear()
}
