import assert from "node:assert/strict"
import test from "node:test"
import { backgroundFor, backgroundJobRouteParams, mergeStatusEvent, mergeStatusSnapshot } from "./background-activity.ts"

const parent = "parent"
const child = (id: string) => ({ id, parentID: parent, title: id, agent: "general", time: { created: 1, updated: 20 } }) as any

test("modern background is authoritative and preserves zero", () => {
  const result = backgroundFor({ parentID: parent, sessions: [child("child")], statuses: { [parent]: { type: "idle", background: { running: 0, jobs: [] } }, child: { type: "busy" } } })
  assert.deepEqual(result, { running: 0, jobs: [] })
})

test("background job navigation prefers the loaded child directory and falls back to the parent", () => {
  const job = { sessionID: "child", role: "QA", title: "Check", since: 1, status: "busy" as const }
  assert.deepEqual(backgroundJobRouteParams(job, [{ ...child("child"), directory: "/child" }], "/parent"), {
    id: "child",
    directory: "/child",
  })
  assert.deepEqual(backgroundJobRouteParams(job, [], "/parent"), { id: "child", directory: "/parent" })
})

test("legacy direct busy child uses parent task metadata", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", time: { start: 10 }, state: { status: "running", title: "task", input: { swarm_role: "QA" }, metadata: { sessionId: "child" } } } as any],
  })
  assert.deepEqual(result, { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Task QA: delegation", since: 10, status: "busy" }] })
})

test("completed parent task excludes stale busy child", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", state: { status: "completed", metadata: { sessionId: "child" } } } as any],
  })
  assert.equal(result, undefined)
})

test("only SSE received during a GET keeps its status over the snapshot", () => {
  assert.deepEqual(
    mergeStatusSnapshot({ fresh: { type: "busy" }, stale: { type: "busy" } }, { fresh: { type: "idle" }, stale: { type: "idle" } }, new Set(["fresh"]), 1),
    { fresh: { type: "busy" }, stale: { type: "idle" } },
  )
})

test("touched SSE inherits GET background only when it omits it", () => {
  const aggregate = { running: 2, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] }
  const snapshot = { parent: { type: "idle" as const, background: aggregate }, untouched: { type: "idle" as const } }
  assert.deepEqual(
    mergeStatusSnapshot({ parent: { type: "retry", attempt: 2, message: "again" }, untouched: { type: "busy" } }, snapshot, new Set(["parent"]), 1),
    { parent: { type: "retry", attempt: 2, message: "again", background: aggregate }, untouched: { type: "idle" } },
  )
  assert.deepEqual(
    mergeStatusSnapshot({ parent: { type: "idle", background: { running: 0, jobs: [] } } }, snapshot, new Set(["parent"]), 1).parent.background,
    { running: 0, jobs: [] },
  )
})

test("snapshot idle or absence settles stale busy IDs", () => {
  assert.deepEqual(
    mergeStatusSnapshot(
      { stale: { type: "busy" }, touched: { type: "busy" } },
      { server: { type: "idle" } },
      new Set(["touched"]),
      1,
    ),
    { stale: { type: "idle" }, touched: { type: "busy" }, server: { type: "idle" } },
  )
})

test("local resync idle revision prevents an older snapshot from resurrecting busy", () => {
  assert.deepEqual(
    mergeStatusSnapshot({ session: { type: "idle" } }, { session: { type: "busy" } }, new Set(["session"]), 1),
    { session: { type: "idle" } },
  )
})

test("omitted background preserves while explicit zero clears", () => {
  const prior = { type: "busy", background: { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] } } as const
  assert.deepEqual(mergeStatusEvent(prior, { type: "idle" }), { type: "idle", background: prior.background })
  assert.deepEqual(mergeStatusEvent(prior, { type: "retry", attempt: 2, message: "again" }), { type: "retry", attempt: 2, message: "again", background: prior.background })
  assert.deepEqual(mergeStatusEvent(prior, { type: "idle", background: { running: 0, jobs: [] } }), { type: "idle", background: { running: 0, jobs: [] } })
})

test("modern jobs control sibling order and terminal legacy jobs disappear everywhere", () => {
  const modern = backgroundFor({ parentID: parent, sessions: [child("a"), child("b")], statuses: { [parent]: { type: "busy", background: { running: 2, jobs: [{ sessionID: "b", role: "B", title: "B", since: 2 }, { sessionID: "a", role: "A", title: "A", since: 1 }] } } } })
  assert.deepEqual(modern?.jobs.map((job) => job.sessionID), ["a", "b"])
  assert.equal(backgroundFor({ parentID: parent, sessions: [child("a")], statuses: { a: { type: "busy" } }, terminalChildIDs: { a: true } }), undefined)
})

test("swarm role derives a useful task title", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", state: { status: "running", input: { swarm_role: "QA", prompt: "Review background activity" }, metadata: { sessionId: "child" } } } as any],
  })
  assert.equal(result?.jobs[0].title, "Task QA: Review background activity")
})
