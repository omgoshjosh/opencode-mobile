import assert from "node:assert/strict"
import { test } from "node:test"
import { listWorkerSummary } from "./list-worker-summary.ts"
import { descendsFrom, unresolvedAncestor } from "./session-ancestry.ts"

const count = (statuses: Record<string, unknown>, parents: Record<string, string | null> = {}, rootID = "root") =>
  listWorkerSummary({ rootID, statuses: statuses as never, sessions: [], parents }).count

const job = (id: string, status?: string) => ({ id, sessionID: id, role: "r", title: "t", owner: "o", ...(status ? { status } : {}) })

test("#53 daemon 5a3a7f3 aggregate: completed jobs never count, blocked jobs do", () => {
  assert.equal(count({ root: { type: "idle", background: { running: true, jobs: [job("a", "running"), job("b", "blocked"), job("c", "completed")] } } }), 2)
  assert.equal(count({ root: { type: "idle", background: { running: false, jobs: [job("b", "blocked"), job("c", "completed")] } } }), 1)
  assert.equal(count({ root: { type: "idle", background: { running: false, jobs: [job("c", "completed")] } } }), 0)
})

test("#53 legacy aggregates keep their meaning", () => {
  // a2ddc01: every job running, running:true
  assert.equal(count({ root: { type: "idle", background: { running: true, jobs: [job("a"), job("b")] } } }), 2)
  // numeric count is authoritative, including zero and undescribed remainders
  assert.equal(count({ root: { type: "idle", background: { running: 0, jobs: [job("a")] } } }), 0)
  assert.equal(count({ root: { type: "idle", background: { running: 3, jobs: [job("a")] } } }), 3)
})

test("#53 an aggregate job that is also a working descendant counts once", () => {
  const statuses = { root: { type: "idle", background: { running: true, jobs: [job("a", "running")] } }, a: { type: "busy" } }
  assert.equal(count(statuses, { a: "root" }), 1)
})

test("#53 working descendants at any depth count; idle, foreign and unknown ones do not", () => {
  const parents = { m: "root", w1: "m", w2: "w1", other: "elsewhere", idle: "root" }
  const statuses = { w1: { type: "busy" }, w2: { type: "retry" }, other: { type: "busy" }, idle: { type: "idle" }, unknown: { type: "busy" }, root: { type: "busy" } }
  assert.equal(count(statuses, parents), 2)
})

test("#53 ancestry walks are cycle-safe and name the next unknown link", () => {
  assert.equal(descendsFrom("a", "root", { a: "b", b: "a" }), false)
  assert.equal(unresolvedAncestor("a", { a: "b", b: "a" }), undefined)
  assert.equal(unresolvedAncestor("w", { w: "m" }), "m")
  assert.equal(unresolvedAncestor("w", { w: "m", m: "root", root: null }), undefined)
  assert.equal(descendsFrom("root", "root", { root: null }), false)
})
