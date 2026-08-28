import assert from "node:assert/strict"
import test from "node:test"
import { backgroundFor } from "./background-activity.ts"

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
