// #53: the session list stopped showing "N working" for the human's swarms.
//
// Observed on the live daemon (5a3a7f3) on Oct 2: root "OpencodeX mobile 9/20"
// idle -> manager idle -> Goomba worker busy, and root "Yondi ci 9/29" idle ->
// Bowser Jr busy. Neither worker is a `background: true` delegation, so the
// daemon never attaches a `background` aggregate to the root; the list keeps
// roots only, so the busy-children fallback had no children to look at; and a
// single background aggregate anywhere on the connection switched that
// fallback off for every row. These tests drive the real stores the way the
// list does and read the chip through the same selector the rows use.
import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"
import { listWorkerSummary } from "../lib/list-worker-summary.ts"

let useConnections: typeof import("./connections").useConnections
let useEvents: typeof import("./events").useEvents
let useSessions: typeof import("./sessions").useSessions

type Row = { id: string; parentID?: string; title: string; time: { created: number; updated: number } }
const row = (id: string, parentID?: string): Row => ({ id, parentID, title: id, time: { created: 0, updated: 0 } })

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function gatedStream(steps: Array<{ gate: Promise<void>; event: object }>) {
  return async function* (signal: AbortSignal) {
    for (const step of steps) {
      await step.gate
      yield step.event
    }
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
}

const status = (sessionID: string, type: string) => ({ payload: { type: "session.status", properties: { sessionID, status: { type } } } })

/** Exactly what a list row renders for `rootID`. */
function chip(rootID: string) {
  const events = useEvents.getState()
  const sessions = useSessions.getState() as unknown as { sessions: never; sessionParents?: Record<string, string | null> }
  return listWorkerSummary({
    rootID,
    statuses: events.sessionStatus,
    sessions: sessions.sessions,
    terminalChildIDs: events.terminalChildIDs,
    questionsBySession: events.questions,
    ...({ parents: sessions.sessionParents } as object),
  })
}

/** Bounded wait: a red run fails with the observed value instead of hanging. */
async function eventually(read: () => number, expected: number, label: string) {
  const deadline = Date.now() + 1500
  let last = read()
  while (last !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    last = read()
  }
  assert.equal(last, expected, label)
}

/**
 * The daemon as observed: `/session/tree?live=true` returns roots carrying only
 * their LIVE direct children (an idle manager is filtered out), `/session/status`
 * returns every non-idle session plus aggregates, and `/session/:id` answers
 * ancestry for anything else.
 */
function daemon({ tree, statuses, byID, events = [] }: {
  tree: Array<Row & { children?: Row[] }>
  statuses: () => Record<string, unknown>
  byID: Record<string, Row>
  events?: Array<{ gate: Promise<void>; event: object }>
}) {
  const gets: string[] = []
  const client = {
    global: { events: gatedStream([{ gate: Promise.resolve(), event: { payload: { type: "connected", properties: {} } } }, ...events]) },
    session: {
      tree: async () => tree,
      list: async () => tree,
      children: async () => [],
      status: async () => statuses(),
      get: async (id: string) => {
        gets.push(id)
        const found = byID[id]
        if (!found) throw Object.assign(new Error(`API Error: 404`), { status: 404 })
        return found
      },
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  return { gets }
}

before(async () => {
  ;({ useConnections } = await import("./connections"))
  ;({ useEvents } = await import("./events"))
  ;({ useSessions } = await import("./sessions"))
})

beforeEach(() => {
  useEvents.getState().disconnect()
  clearNativeMockStorage()
  useConnections.setState(useConnections.getInitialState(), true)
  useEvents.setState(useEvents.getInitialState(), true)
  useSessions.setState(useSessions.getInitialState(), true)
})

afterEach(() => useEvents.getState().disconnect())

test("#53 an idle root shows its working descendants: live child, grandchild, and an unrelated background aggregate", async () => {
  daemon({
    tree: [
      { ...row("root-a"), children: [row("worker-a", "root-a")] },
      { ...row("root-m") },
      { ...row("root-bg") },
    ],
    statuses: () => ({
      "worker-a": { type: "busy" },
      // root-m -> manager (idle, so absent from the live tree) -> goomba (busy)
      goomba: { type: "busy" },
      // A background delegation elsewhere on the connection: one running, one
      // finished-but-undelivered. Only the running one is work.
      "root-bg": {
        type: "idle",
        background: {
          running: true,
          jobs: [
            { id: "bg-run", sessionID: "bg-run", status: "running", role: "QA", title: "Check", owner: "x" },
            { id: "bg-done", sessionID: "bg-done", status: "completed", role: "QA", title: "Done", owner: "x", delivery: "pending" },
          ],
        },
      },
      "bg-run": { type: "busy" },
    }),
    byID: { goomba: row("goomba", "manager"), manager: row("manager", "root-m"), "bg-run": row("bg-run", "root-bg") },
  })

  await useSessions.getState().loadSessions()
  useEvents.getState().connect()

  await eventually(() => chip("root-a").count, 1, "root-a: busy direct child that is not a background delegation")
  await eventually(() => chip("root-m").count, 1, "root-m: busy grandchild under an idle manager")
  await eventually(() => chip("root-bg").count, 1, "root-bg: running job counted once; completed job not counted")
  assert.equal(chip("root-a").label, "1 working")
})

test("#53 the chip follows workers starting and finishing, and counts nested workers accurately", async () => {
  const start = deferred()
  const nested = deferred()
  const finishChild = deferred()
  const finishNested = deferred()
  daemon({
    tree: [{ ...row("root") }],
    statuses: () => ({}),
    byID: {},
    events: [
      { gate: start.promise, event: { payload: { type: "session.created", properties: { info: row("child", "root") } } } },
      { gate: Promise.resolve(), event: status("child", "busy") },
      { gate: nested.promise, event: { payload: { type: "session.created", properties: { info: row("grandchild", "child") } } } },
      { gate: Promise.resolve(), event: status("grandchild", "busy") },
      { gate: finishChild.promise, event: status("child", "idle") },
      { gate: finishNested.promise, event: status("grandchild", "idle") },
    ],
  })
  await useSessions.getState().loadSessions()
  useEvents.getState().connect()
  await eventually(() => (useEvents.getState().transport === "live" ? 1 : 0), 1, "stream live")
  assert.equal(chip("root").count, 0)

  start.resolve()
  await eventually(() => chip("root").count, 1, "child started")
  nested.resolve()
  await eventually(() => chip("root").count, 2, "child and its grandchild both working")
  assert.equal(chip("root").label, "2 working")
  finishChild.resolve()
  await eventually(() => chip("root").count, 1, "child finished, grandchild still working")
  finishNested.resolve()
  await eventually(() => chip("root").count, 0, "all finished")
})

test("#53 a cold start / reconnect restores the chip from the daemon and drops a stale cached worker", async () => {
  const live = { goomba: { type: "busy" } } as Record<string, unknown>
  daemon({
    tree: [{ ...row("root") }],
    statuses: () => live,
    byID: { goomba: row("goomba", "manager"), manager: row("manager", "root"), stale: row("stale", "root") },
  })
  // What a cold start restores from the persisted status cache: a worker the
  // daemon has since finished.
  useEvents.setState({ sessionStatus: { stale: { type: "busy" } } as never })
  await useSessions.getState().loadSessions()
  useEvents.getState().connect()
  await eventually(() => chip("root").count, 1, "restored: goomba only, stale cache dropped by the snapshot")

  // Reconnect after the worker finished: the snapshot omits it.
  useEvents.getState().disconnect()
  delete live.goomba
  useEvents.getState().connect()
  await eventually(() => chip("root").count, 0, "reconnect: finished worker not resurrected")
})

test("#53 deleted, orphaned and cyclic sessions never count and never hang", async () => {
  const remove = deferred()
  const { gets } = daemon({
    tree: [{ ...row("root") }],
    statuses: () => ({ worker: { type: "busy" }, orphan: { type: "busy" }, "loop-a": { type: "busy" } }),
    byID: {
      worker: row("worker", "root"),
      // orphan's parent no longer exists (404)
      orphan: row("orphan", "gone"),
      "loop-a": row("loop-a", "loop-b"),
      "loop-b": row("loop-b", "loop-a"),
    },
    events: [{ gate: remove.promise, event: { payload: { type: "session.deleted", properties: { sessionID: "worker" } } } }],
  })
  await useSessions.getState().loadSessions()
  useEvents.getState().connect()
  await eventually(() => chip("root").count, 1, "only the resolvable worker counts")
  // Ancestry lookups are bounded: each unknown id is fetched at most once.
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(new Set(gets).size, gets.length, `no repeated lookups: ${gets.join(",")}`)

  remove.resolve()
  await eventually(() => chip("root").count, 0, "deleted worker leaves the chip")
})
