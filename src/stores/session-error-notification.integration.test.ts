import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { before, afterEach, beforeEach, mock, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"

const notifications: Array<Record<string, unknown>> = []

mock.module("../lib/notifications", {
  namedExports: {
    send: (payload: Record<string, unknown>) => notifications.push(payload),
  },
})

let useConnections: typeof import("./connections").useConnections
let useEvents: typeof import("./events").useEvents
let useSessions: typeof import("./sessions").useSessions

function liveStream(...events: object[]) {
  return async function* (signal: AbortSignal) {
    for (const event of events) yield event
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

before(async () => {
  ;({ useConnections } = await import("./connections"))
  ;({ useEvents } = await import("./events"))
  ;({ useSessions } = await import("./sessions"))
})

beforeEach(() => {
  useEvents.getState().disconnect()
  clearNativeMockStorage()
  notifications.length = 0
  useConnections.setState(useConnections.getInitialState(), true)
  useEvents.setState(useEvents.getInitialState(), true)
  useSessions.setState(useSessions.getInitialState(), true)
})

afterEach(() => {
  useEvents.getState().disconnect()
})

test("session.error suppresses aborts and routes child failures through the parent", async () => {
  const client = {
    global: {
      events: liveStream(
        { payload: { type: "session.error", properties: { sessionID: "aborted", error: { name: "MessageAbortedError", data: { message: "Stopped" } } } } },
        { payload: { type: "session.error", properties: { sessionID: "child-a", error: { name: "UnknownError", data: { message: "first" } } } } },
        { payload: { type: "session.error", properties: { sessionID: "child-b", error: { message: "second" } } } },
      ),
    },
    session: { status: async () => ({}), messagesPage: async () => ({ items: [] }) },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({
    sessions: [
      { id: "parent" },
      { id: "child-a", parentID: "parent" },
      { id: "child-b", parentID: "parent" },
    ] as never,
  })

  useEvents.getState().connect()
  await settle()

  assert.deepEqual(notifications, [
    {
      category: "errors",
      title: "Session error",
      body: "first",
      sessionId: "parent",
      dedupeKey: "session-error-parent",
      dedupeCooldownMs: 60_000,
    },
    {
      category: "errors",
      title: "Session error",
      body: "second",
      sessionId: "parent",
      dedupeKey: "session-error-parent",
      dedupeCooldownMs: 60_000,
    },
  ])
})

test("retry status notifies once per series and resets after busy", async () => {
  const next = Date.UTC(2026, 0, 2, 15, 4)
  const client = {
    global: {
      events: liveStream(
        { payload: { type: "session.status", properties: { sessionID: "session-a", status: { type: "retry", attempt: 1, message: "Rate limited", next } } } },
        { payload: { type: "session.status", properties: { sessionID: "session-a", status: { type: "retry", attempt: 2, message: "Rate limited", next } } } },
        { payload: { type: "session.status", properties: { sessionID: "session-a", status: { type: "busy" } } } },
        { payload: { type: "session.status", properties: { sessionID: "session-a", status: { type: "retry", attempt: 1, message: "Retrying again", next } } } },
      ),
    },
    session: { status: async () => ({}), messagesPage: async () => ({ items: [] }) },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  useEvents.getState().connect()
  await settle()

  const time = new Date(next).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  assert.deepEqual(notifications.map(({ title, body, sessionId }) => ({ title, body, sessionId })), [
    { title: "Retrying", body: `Retrying (attempt 1): Rate limited, next at ${time}`, sessionId: "session-a" },
    { title: "Retrying", body: `Retrying (attempt 1): Retrying again, next at ${time}`, sessionId: "session-a" },
  ])
})
