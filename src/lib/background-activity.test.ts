import assert from "node:assert/strict"
import test from "node:test"
import { backgroundFor, mergeStatusEvent, mergeStatusSnapshot } from "./background-activity.ts"

const parent = "parent"
const child = (id: string) => ({ id, parentID: parent, title: id, agent: "general", time: { created: 1, updated: 20 } }) as any

test("modern background is authoritative and preserves zero", () => {
  const result = backgroundFor({ parentID: parent, sessions: [child("child")], statuses: { [parent]: { type: "idle", background: { running: 0, jobs: [] } }, child: { type: "busy" } } })
  assert.deepEqual(result, { running: 0, jobs: [] })
})

test("legacy direct busy child uses parent task metadata", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", time: { start: 10 }, state: { status: "running", title: "task", input: { swarm_role: "QA" }, metadata: { sessionId: "child" } } } as any],
  })
  assert.deepEqual(result, { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "task", since: 10, status: "busy" }] })
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

test("SSE keeps only touched IDs over a GET snapshot", () => {
  assert.deepEqual(
    mergeStatusSnapshot({ fresh: { type: "busy" }, stale: { type: "busy" } }, { fresh: { type: "idle" }, stale: { type: "idle" } }, new Set(["fresh"])),
    { fresh: { type: "busy" }, stale: { type: "idle" } },
  )
})

test("omitted background preserves while explicit zero clears", () => {
  const prior = { type: "busy", background: { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] } } as const
  assert.equal(mergeStatusEvent(prior, { type: "busy" }, 2).background?.running, 1)
  assert.equal(mergeStatusEvent(prior, { type: "idle", background: { running: 0, jobs: [] } }, 2).background?.running, 0)
})

test("modern jobs control sibling order and terminal legacy jobs disappear everywhere", () => {
  const modern = backgroundFor({ parentID: parent, sessions: [child("a"), child("b")], statuses: { [parent]: { type: "busy", background: { running: 2, jobs: [{ sessionID: "b", role: "B", title: "B", since: 2 }, { sessionID: "a", role: "A", title: "A", since: 1 }] } } } })
  assert.deepEqual(modern?.jobs.map((job) => job.sessionID), ["a", "b"])
  assert.equal(backgroundFor({ parentID: parent, sessions: [child("a")], statuses: { a: { type: "busy" } }, terminalChildIDs: { a: true } }), undefined)
})
