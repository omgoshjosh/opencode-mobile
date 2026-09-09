import assert from "node:assert/strict"
import { before, beforeEach, mock, test } from "node:test"
import { notifySessionError } from "./session-error-notification.ts"

const scheduled: object[] = []
const appState = { currentState: "background" }

mock.module("react-native", {
  namedExports: {
    Platform: { OS: "ios" },
    AppState: appState,
  },
})
mock.module("expo-device", { namedExports: { isDevice: true } })
mock.module("expo-notifications", {
  namedExports: {
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: () => {},
    getPermissionsAsync: async () => ({ status: "granted" }),
    requestPermissionsAsync: async () => ({ status: "granted" }),
    setNotificationChannelAsync: async () => {},
    scheduleNotificationAsync: async (payload: object) => void scheduled.push(payload),
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  },
})

let send: typeof import("./notifications.ts").send

before(async () => {
  ;({ send } = await import("./notifications.ts"))
})

beforeEach(() => {
  scheduled.length = 0
})

test("delivers child fan-out as one parent incident while backgrounded", async () => {
  appState.currentState = "background"
  const sessions = [
    { id: "parent-test" },
    { id: "child-a", parentID: "parent-test" },
    { id: "child-b", parentID: "parent-test" },
  ]

  await notifySessionError(send, "child-a", { message: "first" }, sessions)
  await notifySessionError(send, "child-b", { message: "second" }, sessions)

  assert.equal(scheduled.length, 1)
})

test("does not deliver errors while the app is active", async () => {
  appState.currentState = "active"

  await send({
    category: "errors",
    title: "Session error",
    body: "failed",
    sessionId: "active",
    dedupeKey: "session-error-active-test",
  })

  assert.equal(scheduled.length, 0)
})
