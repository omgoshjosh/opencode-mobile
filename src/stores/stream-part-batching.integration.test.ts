import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { test } from "node:test"

const session = (id: string) => ({ id, slug: id, projectID: "p", directory: "", title: id, version: "1", time: { created: 1, updated: 1 } })

test("part received during selectSession fetch lands in its destination transcript", async () => {
  const { useSessions } = await import("./sessions")
  const { useConnections } = await import("./connections")
  let resolveGet!: (value: any) => void
  let resolvePage!: (value: any) => void
  const client: any = { session: { get: () => new Promise((resolve) => { resolveGet = resolve }), messagesPage: () => new Promise((resolve) => { resolvePage = resolve }) } }
  useConnections.setState({ client })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s2", messages: [], parts: {}, sessions: [session("s2")] })
  const pending = useSessions.getState().selectSession("s2")
  useSessions.getState().handleEvent({ type: "message.part.updated", properties: { part: { id: "p", sessionID: "s2", messageID: "m", type: "text", text: "live" } } } as any)
  resolveGet(session("s2"))
  resolvePage({ items: [{ info: { id: "m", sessionID: "s2", role: "assistant", time: { created: 1 } }, parts: [] }], nextCursor: undefined })
  await pending
  assert.equal(useSessions.getState().parts.m?.[0]?.text, "live")
})
