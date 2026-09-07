import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"
import { deriveWorkerStates } from "../lib/worker-states.ts"

let useConnections: typeof import("./connections").useConnections
let useEvents: typeof import("./events").useEvents
let useSessions: typeof import("./sessions").useSessions

function question(id: string, sessionID: string) {
  return { id, sessionID, questions: [{ question: "Ship it?", header: "Deploy", options: [{ label: "Yes", description: "" }] }] }
}

function deferred<T>() {
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

function liveStream(...events: object[]) {
  return async function* (signal: AbortSignal) {
    for (const event of events) yield event
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
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
  useSessions.setState(useSessions.getInitialState(), true)
})

afterEach(() => useEvents.getState().disconnect())

test("connecting hydrates a pending question for a CHILD session, not just the open one", async () => {
  // The regression: `refreshPending` filters GET /question down to the session
  // being entered, and SSE resumes from "now" without replaying. A worker that
  // asked before this connection existed was invisible — its parent's chip
  // said "working" and nothing pointed at the blocked child.
  const client = {
    global: { events: liveStream({ payload: { type: "connected", properties: {} } }) },
    session: { status: async () => ({}) },
    question: { list: async () => [question("q1", "child")] },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: { id: "parent" } as never, activeTranscriptSessionID: "parent" })

  useEvents.getState().connect()
  await waitForEvents(() => Boolean(useEvents.getState().questions.child?.length))

  assert.deepEqual(useEvents.getState().questions.child?.map((q) => q.id), ["q1"])
  // ...and that is exactly what turns the child's job into "needs input".
  const derived = deriveWorkerStates({ jobs: [{ sessionID: "child" }], questionsBySession: useEvents.getState().questions })
  assert.equal(derived[0]!.state, "awaiting-answer")
})

test("a question asked while the hydration GET is in flight survives the snapshot", async () => {
  const list = deferred<Array<ReturnType<typeof question>>>()
  const client = {
    global: { events: liveStream({ payload: { type: "connected", properties: {} } }, { payload: { type: "question.asked", properties: question("q2", "child-b") } }) },
    session: { status: async () => ({}) },
    question: { list: async () => list.promise },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  useEvents.getState().connect()
  await waitForEvents(() => Boolean(useEvents.getState().questions["child-b"]?.length))
  // The snapshot was assembled before q2 existed; it must not erase it.
  list.resolve([question("q1", "child-a")])
  await waitForEvents(() => Boolean(useEvents.getState().questions["child-a"]?.length))

  assert.deepEqual(useEvents.getState().questions["child-a"]?.map((q) => q.id), ["q1"])
  assert.deepEqual(useEvents.getState().questions["child-b"]?.map((q) => q.id), ["q2"])
})

test("rejecting a child's question clears its row and drops it back to working", async () => {
  const client = {
    global: {
      events: liveStream(
        { payload: { type: "connected", properties: {} } },
        { payload: { type: "question.asked", properties: question("q1", "child") } },
        { payload: { type: "question.rejected", properties: { sessionID: "child", requestID: "q1" } } },
      ),
    },
    session: { status: async () => ({}) },
    question: { list: async () => [] },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  useEvents.getState().connect()
  await waitForEvents(() => useEvents.getState().questions.child?.length === 0)

  assert.deepEqual(useEvents.getState().questions.child, [])
  const derived = deriveWorkerStates({ jobs: [{ sessionID: "child" }], questionsBySession: useEvents.getState().questions })
  assert.equal(derived[0]!.state, "working")
})
