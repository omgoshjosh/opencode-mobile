import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"
import { runningWorkerCount } from "../lib/background-activity.ts"

let useConnections: typeof import("./connections").useConnections
let useEvents: typeof import("./events").useEvents
let useSessions: typeof import("./sessions").useSessions

const session = (id: string, parentID?: string) => ({ id, parentID, title: id, time: { created: 0, updated: 0 } })

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function waitForEvents(check: () => boolean): Promise<void> {
  if (check()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useEvents.subscribe(() => {
      if (!check()) return
      unsubscribe()
      resolve()
    })
  })
}

/** An SSE stream that releases one event per `gate`, so a test can assert between them. */
function gatedStream(steps: Array<{ gate: Promise<void>; event: object }>) {
  return async function* (signal: AbortSignal) {
    for (const step of steps) {
      await step.gate
      yield step.event
    }
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
}

/** How the sessions list reads the chip: no parts, no navigation. */
function listWorkerCount(parentID: string): number {
  const events = useEvents.getState()
  return runningWorkerCount({
    parentID,
    statuses: events.sessionStatus,
    sessions: useSessions.getState().sessions as never,
    terminalChildIDs: events.terminalChildIDs,
  })
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

test("M-8 uses the live tree roots and falls back when it is unavailable", async () => {
  const root = session("root")
  const client = {
    session: {
      tree: async () => null,
      list: async () => [root],
      children: async () => [],
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  await useSessions.getState().loadSessions()

  assert.deepEqual(useSessions.getState().sessions.map((item) => item.id), ["root"])
})

test("M-8 keeps only children whose parentID matches a visible root", async () => {
  const root = session("root")
  const client = {
    session: {
      tree: async () => [root],
      list: async () => [root],
      children: async () => [session("worker", "root"), session("wrong-parent", "other")],
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  await useSessions.getState().loadSessions()
  await useSessions.getState().loadSessionChildren("root")

  assert.deepEqual(useSessions.getState().sessions.map((item) => item.id), ["root", "worker"])
  assert.equal(useSessions.getState().sessions.filter((item) => !item.parentID).length, 1)
})

// A finished child must not keep the workers chip at 1 (#44). The human saw
// "1 worker running" on a parent whose task part was `completed`, whose child
// delegation was settled/delivered and whose child execution was idle — stale
// client state, not server truth.
test("#44 a completed child clears the list chip, and no later snapshot resurrects it", async () => {
  const busy = deferred()
  const finished = deferred()
  const statusRequests: number[] = []
  const client = {
    global: {
      events: gatedStream([
        { gate: Promise.resolve(), event: { payload: { type: "connected", properties: {} } } },
        {
          gate: busy.promise,
          event: { payload: { type: "session.status", properties: { sessionID: "child", status: { type: "busy" } } } },
        },
        // The child finishes. Its own status settles, and the parent's task
        // part reaches `completed` — the two pieces of evidence the list has.
        {
          gate: finished.promise,
          event: { payload: { type: "session.status", properties: { sessionID: "child", status: { type: "idle" } } } },
        },
        {
          gate: Promise.resolve(),
          event: {
            payload: {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "prt_task", messageID: "msg", sessionID: "parent", type: "tool", tool: "task",
                  state: { status: "completed", metadata: { sessionId: "child" } },
                },
              },
            },
          },
        },
      ]),
    },
    // The real payload shape: the daemon omits `background` entirely when a
    // parent has no running jobs, so this snapshot never carries the key.
    session: { status: async () => { statusRequests.push(Date.now()); return {} } },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ sessions: [session("parent"), session("child", "parent")] as never })

  useEvents.getState().connect()
  await waitForEvents(() => useEvents.getState().transport === "live")

  busy.resolve()
  await waitForEvents(() => useEvents.getState().sessionStatus.child?.type === "busy")
  assert.equal(listWorkerCount("parent"), 1)

  finished.resolve()
  await waitForEvents(() => useEvents.getState().terminalChildIDs.child === true)
  // No parts supplied, no session switch, no re-hydration — just the events.
  assert.equal(listWorkerCount("parent"), 0)

  // Reopening/reconnecting re-hydrates from GET /session/status. Seed exactly
  // what a cold start restores from the persisted cache — a stale busy child
  // and the aggregate a GET once reported — then let the reconnect hydrate.
  // The snapshot still lacks `background`, so it must clear both.
  assert.equal(statusRequests.length > 0, true)
  useEvents.getState().disconnect()
  useEvents.setState({
    sessionStatus: {
      parent: { type: "idle", background: { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] } },
      child: { type: "busy" },
    } as never,
  })
  useEvents.getState().connect()
  await waitForEvents(() => useEvents.getState().sessionStatus.child?.type === "idle")

  assert.equal(useEvents.getState().sessionStatus.parent?.background, undefined)
  assert.equal(listWorkerCount("parent"), 0)
})
