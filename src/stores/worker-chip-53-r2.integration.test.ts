// #53 review round 2 (#2): a failed or pending ancestry lookup is partial knowledge, not a root.
import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"
import * as summary from "../lib/list-worker-summary.ts"

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

function input() {
  const events = useEvents.getState()
  const sessions = useSessions.getState() as unknown as { sessions: never; sessionParents?: Record<string, string | null> }
  return { statuses: events.sessionStatus, sessions: sessions.sessions, parents: sessions.sessionParents, terminalChildIDs: events.terminalChildIDs }
}

const chip = (rootID: string) => summary.listWorkerSummary({ rootID, ...input() }).count
const unplaced = (): string[] =>
  ((summary as Record<string, unknown>).unplacedWorkerIDs as undefined | ((value: object) => string[]))?.(input()) ?? []

async function eventually<T>(read: () => T, expected: T, label: string) {
  const deadline = Date.now() + 1500
  let last = read()
  while (JSON.stringify(last) !== JSON.stringify(expected) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    last = read()
  }
  assert.deepEqual(last, expected, label)
}

function daemon(get: (id: string) => Promise<Row>) {
  const gets: string[] = []
  const stream = async function* (signal: AbortSignal) {
    yield { payload: { type: "connected", properties: {} } }
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
  const client = {
    global: { events: stream },
    session: {
      tree: async () => [row("root")],
      list: async () => [row("root")],
      children: async () => [],
      status: async () => ({ goomba: { type: "busy" } }),
      get: async (id: string) => { gets.push(id); return get(id) },
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

test("#53 r2: a failed manager lookup shows partial, then the next hydration recovers the exact count", async () => {
  let managerUp = false
  const { gets } = daemon(async (id) => {
    if (id === "goomba") return row("goomba", "manager")
    if (id === "manager" && managerUp) return row("manager", "root")
    throw Object.assign(new Error("network"), { status: 503 })
  })
  await useSessions.getState().loadSessions()
  useEvents.getState().connect()

  await eventually(unplaced, ["goomba"], "failed manager lookup: goomba is reported unplaced")
  assert.equal(chip("root"), 0, "an unplaced worker is not part of the root's exact N")
  assert.equal(useSessions.getState().sessionParents.manager, undefined, "a failed lookup is not recorded as a root")
  const failedAsks = gets.filter((id) => id === "manager").length
  assert.equal(failedAsks, 1, "asked once per hydration")

  // The next status hydration (reconnect) retries the failed link.
  managerUp = true
  useEvents.getState().disconnect()
  useEvents.getState().connect()
  await eventually(() => chip("root"), 1, "recovered: exact count")
  assert.deepEqual(unplaced(), [])
})

test("#53 r2: a pending lookup is unplaced until it answers, then placed", async () => {
  const manager = deferred<Row>()
  daemon(async (id) => (id === "goomba" ? row("goomba", "manager") : manager.promise))
  await useSessions.getState().loadSessions()
  useEvents.getState().connect()

  await eventually(unplaced, ["goomba"], "pending: unplaced")
  assert.equal(chip("root"), 0)
  manager.resolve(row("manager", "root"))
  await eventually(() => chip("root"), 1, "placed")
  assert.deepEqual(unplaced(), [])
})
