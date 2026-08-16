import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_TRACKED_VIEWS,
  attentionFor,
  attentionLabel,
  attentionRank,
  isActionable,
  isAttentionWorthShowing,
  markViewed,
  parseLastViewed,
  type Attention,
  type LastViewedMap,
} from "./session-attention.ts"

// --- blocked on the user ---

test("a pending permission means the session needs you", () => {
  assert.equal(attentionFor({ status: "busy", pendingPermissions: 1 }), "needs-attention")
})

test("a pending question means the session needs you", () => {
  assert.equal(attentionFor({ status: "idle", pendingQuestions: 1 }), "needs-attention")
})

// The server still reports busy while a permission is pending, because the run
// has not ended -- but nothing is progressing, and the user is the bottleneck.
test("needs-attention outranks busy, which would otherwise bury it", () => {
  assert.equal(attentionFor({ status: "busy", pendingPermissions: 2, pendingQuestions: 1 }), "needs-attention")
})

test("needs-attention outranks retry too", () => {
  assert.equal(attentionFor({ status: "retry", pendingQuestions: 1 }), "needs-attention")
})

// --- running ---

test("a running session is busy", () => {
  assert.equal(attentionFor({ status: "busy" }), "busy")
})

test("retry is distinguished from plain busy", () => {
  assert.equal(attentionFor({ status: "retry" }), "retry")
})

test("running outranks unseen output", () => {
  assert.equal(attentionFor({ status: "busy", updatedAt: 100, lastViewedAt: 1 }), "busy")
})

// --- complete vs idle ---

test("output produced since the last view reads as complete", () => {
  assert.equal(attentionFor({ status: "idle", updatedAt: 200, lastViewedAt: 100 }), "complete")
})

test("a session viewed after its last update is idle", () => {
  assert.equal(attentionFor({ status: "idle", updatedAt: 100, lastViewedAt: 200 }), "idle")
})

test("viewing at exactly the update time counts as seen", () => {
  assert.equal(attentionFor({ status: "idle", updatedAt: 100, lastViewedAt: 100 }), "idle")
})

test("a never-opened session with output is unseen", () => {
  assert.equal(attentionFor({ status: "idle", updatedAt: 100 }), "complete")
})

// Otherwise every newly created session would immediately claim to have
// something to read.
test("a never-opened session with no activity is idle, not complete", () => {
  assert.equal(attentionFor({ status: "idle" }), "idle")
  assert.equal(attentionFor({ status: "idle", updatedAt: 0 }), "idle")
})

test("an unknown status degrades to the seen/unseen distinction", () => {
  assert.equal(attentionFor({ updatedAt: 200, lastViewedAt: 100 }), "complete")
  assert.equal(attentionFor({}), "idle")
})

test("zero pending counts do not mean blocked", () => {
  assert.equal(attentionFor({ status: "idle", pendingPermissions: 0, pendingQuestions: 0 }), "idle")
})

// --- ordering ---

test("actionable states sort ahead of quiet ones", () => {
  const states: Attention[] = ["idle", "complete", "busy", "retry", "needs-attention"]
  const sorted = [...states].sort((a, b) => attentionRank(a) - attentionRank(b))
  assert.deepEqual(sorted, ["needs-attention", "retry", "busy", "complete", "idle"])
})

// --- presentation ---

test("every state has a distinct label", () => {
  const states: Attention[] = ["needs-attention", "busy", "retry", "complete", "idle"]
  const labels = states.map(attentionLabel)
  assert.equal(new Set(labels).size, states.length)
})

// Badging every quiet row is noise that hides the meaningful badges.
test("only idle is hidden", () => {
  assert.equal(isAttentionWorthShowing("idle"), false)
  assert.equal(isAttentionWorthShowing("complete"), true)
  assert.equal(isAttentionWorthShowing("needs-attention"), true)
})

test("only needs-attention is flagged as actionable", () => {
  assert.equal(isActionable("needs-attention"), true)
  assert.equal(isActionable("busy"), false)
  assert.equal(isActionable("complete"), false)
})

// --- view tracking ---

test("a view is recorded and flips complete to idle", () => {
  const map = markViewed({}, "s1", 500)
  assert.equal(map.s1, 500)
  assert.equal(attentionFor({ status: "idle", updatedAt: 400, lastViewedAt: map.s1 }), "idle")
})

test("re-viewing overwrites the earlier time", () => {
  let map = markViewed({}, "s1", 100)
  map = markViewed(map, "s1", 900)
  assert.equal(map.s1, 900)
})

test("an empty session id is ignored", () => {
  assert.deepEqual(markViewed({}, "", 1), {})
})

test("view tracking is bounded, dropping the oldest", () => {
  let map: LastViewedMap = {}
  for (let i = 0; i < MAX_TRACKED_VIEWS + 5; i++) map = markViewed(map, `s${i}`, i)
  assert.equal(Object.keys(map).length, MAX_TRACKED_VIEWS)
  assert.equal(map.s0, undefined)
})

test("markViewed does not mutate its input", () => {
  const original: LastViewedMap = {}
  markViewed(original, "s1", 1)
  assert.deepEqual(original, {})
})

// --- persistence parsing ---

test("a persisted map round-trips", () => {
  assert.deepEqual(parseLastViewed(JSON.stringify({ s1: 10, s2: 20 })), { s1: 10, s2: 20 })
})

// Losing read-state is acceptable; crashing the session list on launch is not.
test("corrupt or unexpected persisted values degrade to empty", () => {
  assert.deepEqual(parseLastViewed("not json"), {})
  assert.deepEqual(parseLastViewed("[1,2,3]"), {})
  assert.deepEqual(parseLastViewed("null"), {})
  assert.deepEqual(parseLastViewed(null), {})
  assert.deepEqual(parseLastViewed(""), {})
})

test("non-numeric and negative entries are dropped rather than trusted", () => {
  assert.deepEqual(parseLastViewed(JSON.stringify({ ok: 5, bad: "x", neg: -1, nan: null })), { ok: 5 })
})
