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

test("real stores coalesce 1,000 foreground events and isolate background status", async () => {
  const { useSessions, flushPendingStreamParts, cancelPendingStreamParts } = await import("./sessions")
  const { useEvents, receiveStreamPart, flushPendingPartStatus } = await import("./events")
  const current = session("s1")
  const keep = [{ id: "keep", messageID: "keep", sessionID: "s1", type: "text", text: "keep" }]
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: current, activeTranscriptSessionID: "s1", messages: [], parts: { keep }, previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy" } }, statusText: {} })
  let sessionWrites = 0
  let eventWrites = 0
  const stopSessions = useSessions.subscribe(() => sessionWrites++)
  const stopEvents = useEvents.subscribe(() => eventWrites++)
  for (let i = 0; i < 1_000; i++) receiveStreamPart({ id: `p${i % 2}`, sessionID: "s1", messageID: i % 2 ? "m2" : "m1", type: "text", text: `v${i}` } as any, i)
  receiveStreamPart({ id: "p0", sessionID: "s2", messageID: "m1", type: "text", text: "background" } as any, 1_001)
  flushPendingPartStatus()
  flushPendingStreamParts()
  stopSessions()
  stopEvents()
  const state = useSessions.getState()
  assert.equal(sessionWrites, 1)
  assert.equal(eventWrites, 1)
  assert.equal(state.parts.m1?.[0]?.text, "v998")
  assert.equal(state.parts.m2?.[0]?.text, "v999")
  assert.strictEqual(state.parts.keep, keep)
  assert.equal(state.previews.s2?.text, "background")
  assert.equal(useEvents.getState().statusText.s2, undefined)
  assert.equal(useEvents.getState().sessionStatus.s2, undefined)
})

test("terminal and disconnect receipt paths synchronously drain queued real-store state", async () => {
  const { useSessions, cancelPendingStreamParts } = await import("./sessions")
  const { useEvents, receiveStreamPart } = await import("./events")
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", parts: {}, previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy" } }, statusText: {} })
  receiveStreamPart({ id: "text", sessionID: "s1", messageID: "m", type: "text", text: "final" } as any, 1)
  receiveStreamPart({ id: "tool", sessionID: "s1", messageID: "m", type: "tool", tool: "bash", state: { status: "completed" } } as any, 2)
  assert.equal(useSessions.getState().parts.m?.[0]?.text, "final")
  useEvents.getState().disconnect()
  assert.equal(useEvents.getState().statusText.s1, undefined)
})
