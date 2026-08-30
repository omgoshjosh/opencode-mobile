import assert from "node:assert/strict"
import { test } from "node:test"
import { resyncBusySession } from "./reconnect-resync.ts"

test("busy-session reconnect resync requests only the newest message", async () => {
  let received: unknown[] = []
  let markedIdle = false

  await resyncBusySession({
    client: {
      session: {
        messages: async (...args: unknown[]) => {
          received = args
          return [{ info: { role: "assistant", time: { completed: 1 } } }]
        },
      },
    } as never,
    sessionID: "s1",
    isBusy: () => true,
    canApply: () => true,
    markIdle: () => {
      markedIdle = true
    },
  })

  assert.deepEqual(received, ["s1", { limit: 1 }])
  assert.equal(markedIdle, true)
})
