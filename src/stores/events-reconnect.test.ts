import assert from "node:assert/strict"
import { register } from "node:module"
import { test } from "node:test"

function store<T>(state: T) {
  return {
    getState: () => state,
    setState: (next: Partial<T>) => {
      Object.assign(state, next)
    },
  }
}

test("reconnect resync fetches only the newest message", async () => {
  let resolveMessages: (() => void) | undefined
  const called = new Promise<void>((resolve) => {
    resolveMessages = resolve
  })
  let received: unknown[] = []
  const client = {
    global: {
      events: async function* () {
        yield { type: "server.heartbeat" }
        await new Promise(() => {})
      },
    },
    session: {
      messages: async (...args: unknown[]) => {
        received = args
        resolveMessages?.()
        return []
      },
      status: async () => null,
    },
  }

  ;(globalThis as typeof globalThis & Record<string, unknown>).__eventReconnectConnections = store({
    client,
    clientForDirectory: () => null,
  })
  ;(globalThis as typeof globalThis & Record<string, unknown>).__eventReconnectSessions = store({
    sessions: [{ id: "s1" }],
    currentSession: null,
    activeTranscriptSessionID: null,
    sending: {},
    runningTools: {},
    refreshMessages: async () => {},
    handleEvent: () => {},
  })
  register("./events-reconnect-loader.mjs", import.meta.url)
  const { useEvents } = await import("./events.ts")
  useEvents.setState({ reconnectAttempts: 1, sessionStatus: { s1: { type: "busy" } } })

  useEvents.getState().connect()
  await called
  useEvents.getState().disconnect()

  assert.deepEqual(received, ["s1", { limit: 1 }])
})
