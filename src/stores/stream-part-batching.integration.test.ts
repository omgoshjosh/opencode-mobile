import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { test } from "node:test"

const session = (id: string) => ({ id, slug: id, projectID: "p", directory: "", title: id, version: "1", time: { created: 1, updated: 1 } })
const waitForStore = (store: { getState: () => unknown; subscribe: (listener: () => void) => () => void }, matches: () => boolean) =>
  new Promise<void>((resolve) => {
    if (matches()) return resolve()
    const stop = store.subscribe(() => {
      if (!matches()) return
      stop()
      resolve()
    })
  })

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
  let transcriptSelectorWrites = 0
  let foregroundStatusSelectorWrites = 0
  let selectedParts = useSessions.getState().parts
  let selectedStatus = useEvents.getState().statusText.s1
  const stopSessions = useSessions.subscribe(() => sessionWrites++)
  const stopEvents = useEvents.subscribe(() => eventWrites++)
  const stopTranscriptSelector = useSessions.subscribe((state) => {
    if (state.parts === selectedParts) return
    selectedParts = state.parts
    transcriptSelectorWrites++
  })
  const stopForegroundStatusSelector = useEvents.subscribe((state) => {
    if (state.statusText.s1 === selectedStatus) return
    selectedStatus = state.statusText.s1
    foregroundStatusSelectorWrites++
  })
  for (let i = 0; i < 1_000; i++) receiveStreamPart({ id: `p${i % 2}`, sessionID: "s1", messageID: i % 2 ? "m2" : "m1", type: "text", text: `v${i}` } as any, i)
  receiveStreamPart({ id: "p0", sessionID: "s2", messageID: "m1", type: "text", text: "background" } as any, 1_001)
  flushPendingPartStatus()
  flushPendingStreamParts()
  stopSessions()
  stopEvents()
  stopTranscriptSelector()
  stopForegroundStatusSelector()
  const state = useSessions.getState()
  assert.equal(sessionWrites, 1)
  assert.equal(eventWrites, 1)
  assert.equal(transcriptSelectorWrites, 1)
  assert.equal(foregroundStatusSelectorWrites, 1)
  assert.equal(state.parts.m1?.[0]?.text, "v998")
  assert.equal(state.parts.m2?.[0]?.text, "v999")
  assert.strictEqual(state.parts.keep, keep)
  assert.equal(state.previews.s2?.text, "background")
  assert.equal(useEvents.getState().statusText.s2, undefined)
  assert.equal(useEvents.getState().sessionStatus.s2, undefined)
})

test("terminal and disconnect receipt paths synchronously drain queued real-store state", async () => {
  const { useSessions, cancelPendingStreamParts, flushPendingStreamParts } = await import("./sessions")
  const { useEvents, receiveStreamPart, flushPendingPartStatus } = await import("./events")
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", parts: {}, previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy" } }, statusText: {} })
  receiveStreamPart({ id: "text", sessionID: "s1", messageID: "m", type: "text", text: "final" } as any, 1)
  receiveStreamPart({ id: "tool", sessionID: "s1", messageID: "m", type: "tool", tool: "bash", state: { status: "completed" } } as any, 2)
  assert.equal(useSessions.getState().parts.m?.[0]?.text, "final")
  assert.notEqual(useEvents.getState().statusText.s1, undefined)
  receiveStreamPart({ id: "late", sessionID: "s1", messageID: "m", type: "text", text: "disconnect final" } as any, 3)
  useEvents.getState().disconnect()
  assert.equal(useEvents.getState().statusText.s1, undefined)
  assert.equal(useSessions.getState().parts.m?.find((part) => part.id === "late")?.text, "disconnect final")
  let lateWrites = 0
  const stop = useEvents.subscribe(() => lateWrites++)
  flushPendingPartStatus()
  flushPendingStreamParts()
  stop()
  assert.equal(lateWrites, 0)
})

test("background-only parts update previews and tools without foreground status selectors", async () => {
  const { useSessions, cancelPendingStreamParts, flushPendingStreamParts } = await import("./sessions")
  const { useEvents, receiveStreamPart, flushPendingPartStatus } = await import("./events")
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy", lastActivityAt: 1 } }, statusText: { s1: "Writing..." } })
  let textWrites = 0
  let activityWrites = 0
  let text = useEvents.getState().statusText.s1
  let activity = useEvents.getState().sessionStatus.s1.lastActivityAt
  const stop = useEvents.subscribe((state) => {
    if (state.statusText.s1 !== text) { text = state.statusText.s1; textWrites++ }
    if (state.sessionStatus.s1.lastActivityAt !== activity) { activity = state.sessionStatus.s1.lastActivityAt; activityWrites++ }
  })
  receiveStreamPart({ id: "bg-text", sessionID: "s2", messageID: "m", type: "text", text: "background" } as any, 2)
  receiveStreamPart({ id: "bg-tool", sessionID: "s2", messageID: "m", type: "tool", tool: "bash", state: { status: "running" } } as any, 3)
  flushPendingPartStatus()
  flushPendingStreamParts()
  stop()
  assert.equal(useSessions.getState().previews.s2?.text, "background")
  assert.equal(useSessions.getState().runningTools.s2?.[0]?.partID, "bg-tool")
  assert.equal(textWrites, 0)
  assert.equal(activityWrites, 0)
})

test("navigation synchronously drains outgoing transcript and status without resurrection", async () => {
  const { useSessions, cancelPendingStreamParts, flushPendingStreamParts } = await import("./sessions")
  const { useEvents, receiveStreamPart, flushPendingPartStatus } = await import("./events")
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", parts: {}, previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy" } }, statusText: {} })
  receiveStreamPart({ id: "outgoing", sessionID: "s1", messageID: "m", type: "text", text: "before switch" } as any, 9)
  useSessions.getState().setTranscriptActive("s1", false)
  assert.equal(useSessions.getState().parts.m?.[0]?.text, "before switch")
  assert.equal(useEvents.getState().statusText.s1, "Writing...")
  const before = useEvents.getState().statusText.s1
  flushPendingPartStatus()
  flushPendingStreamParts()
  assert.equal(useEvents.getState().statusText.s1, before)
})

test("SSE dispatcher flushes queued content on idle and stream closure", async () => {
  const { useSessions, cancelPendingStreamParts, flushPendingStreamParts } = await import("./sessions")
  const { useEvents, flushPendingPartStatus } = await import("./events")
  const { useConnections } = await import("./connections")
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", parts: {}, previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy" } }, statusText: {}, reconnectAttempts: 0 })
  const client: any = { session: { messages: async () => [] }, global: { events: async function* () {
    yield { type: "message.part.updated", properties: { part: { id: "idle-text", sessionID: "s1", messageID: "m", type: "text", text: "idle final" } } }
    yield { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }
  } } }
  useConnections.setState({ client })
  useEvents.getState().connect()
  await waitForStore(useEvents, () => useEvents.getState().sessionStatus.s1?.type === "idle")
  assert.equal(useSessions.getState().parts.m?.[0]?.text, "idle final")
  assert.equal(useEvents.getState().sessionStatus.s1.type, "idle")
  const status = useEvents.getState().statusText.s1
  flushPendingPartStatus(); flushPendingStreamParts()
  assert.equal(useEvents.getState().statusText.s1, status)
  await waitForStore(useEvents, () => useEvents.getState().reconnectAttempts === 1)
  assert.equal(useEvents.getState().reconnectAttempts, 1)
  useEvents.getState().disconnect()
})

test("SSE dispatcher flushes queued content before session.error cleanup", async () => {
  const { useSessions, cancelPendingStreamParts, flushPendingStreamParts } = await import("./sessions")
  const { useEvents, flushPendingPartStatus } = await import("./events")
  const { useConnections } = await import("./connections")
  cancelPendingStreamParts()
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", parts: {}, previews: {}, runningTools: {}, pendingWakes: {} })
  useEvents.setState({ sessionStatus: { s1: { type: "busy" } }, statusText: {} })
  const client: any = { session: { messages: async () => [] }, global: { events: async function* () {
    yield { type: "message.part.updated", properties: { part: { id: "error-text", sessionID: "s1", messageID: "m", type: "text", text: "error final" } } }
    yield { type: "session.error", properties: { sessionID: "s1", error: { message: "boom" } } }
    await new Promise(() => {})
  } } }
  useConnections.setState({ client })
  useEvents.getState().connect()
  await waitForStore(useSessions, () => useSessions.getState().error === "boom")
  assert.equal(useSessions.getState().parts.m?.[0]?.text, "error final")
  assert.equal(useSessions.getState().error, "boom")
  const writes = useEvents.getState().statusText.s1
  flushPendingPartStatus(); flushPendingStreamParts()
  assert.equal(useEvents.getState().statusText.s1, writes)
  useEvents.getState().disconnect()
})
