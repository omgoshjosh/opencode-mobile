import { test } from "node:test"
import assert from "node:assert/strict"
import { hasActiveSession, statusCounts } from "./session-status-counts.ts"

const status = (map: Record<string, string>) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { type: v }]))

test("counts each status present, most attention-worthy first", () => {
  const counts = statusCounts(
    ["a", "b", "c", "d", "e"],
    status({ a: "busy", b: "busy", c: "retry", d: "idle", e: "busy" }),
  )
  assert.deepEqual(counts, [
    { status: "busy", count: 3 },
    { status: "retry", count: 1 },
    { status: "idle", count: 1 },
  ])
})

// The point of the whole module: no "0 busy · 0 retry · 7 idle" noise.
test("omits statuses with no members rather than showing zeroes", () => {
  const counts = statusCounts(["a", "b"], status({ a: "idle", b: "idle" }))
  assert.deepEqual(counts, [{ status: "idle", count: 2 }])
})

test("a session with no reported status counts as idle", () => {
  const counts = statusCounts(["a", "b"], status({ a: "busy" }))
  assert.deepEqual(counts, [
    { status: "busy", count: 1 },
    { status: "idle", count: 1 },
  ])
})

test("an unrecognised status is treated as idle, not dropped", () => {
  // Losing a session from the count would make the badges disagree with the
  // group's row count, which looks like a bug to the user.
  const counts = statusCounts(["a", "b"], status({ a: "something-new", b: "busy" }))
  assert.deepEqual(counts, [
    { status: "busy", count: 1 },
    { status: "idle", count: 1 },
  ])
  assert.equal(counts.reduce((n, c) => n + c.count, 0), 2)
})

test("empty group produces no badges at all", () => {
  assert.deepEqual(statusCounts([], status({})), [])
})

test("tolerates a missing status map", () => {
  assert.deepEqual(statusCounts(["a"], null), [{ status: "idle", count: 1 }])
  assert.deepEqual(statusCounts(["a"], undefined), [{ status: "idle", count: 1 }])
})

test("ordering is by priority, not by count", () => {
  const counts = statusCounts(
    ["a", "b", "c", "d"],
    status({ a: "idle", b: "idle", c: "idle", d: "busy" }),
  )
  assert.deepEqual(counts.map((c) => c.status), ["busy", "idle"])
})

test("hasActiveSession reflects busy or retry only", () => {
  assert.equal(hasActiveSession([{ status: "busy", count: 1 }]), true)
  assert.equal(hasActiveSession([{ status: "retry", count: 1 }]), true)
  assert.equal(hasActiveSession([{ status: "idle", count: 9 }]), false)
  assert.equal(hasActiveSession([]), false)
})
