import { test } from "node:test"
import assert from "node:assert/strict"
import { nextSessionStatus, noteTextActivity, type SessionStatus } from "./busy-lifecycle.ts"

const NOW = 10_000

test("a fresh bare busy status begins the current turn", () => {
  assert.deepEqual(nextSessionStatus(undefined, { type: "busy" }, NOW), {
    type: "busy",
    since: NOW,
    lastActivityAt: NOW,
  })
})

test("idle to bare busy begins a new epoch", () => {
  const prior: SessionStatus = { type: "idle" }
  assert.deepEqual(nextSessionStatus(prior, { type: "busy" }, NOW), {
    type: "busy",
    since: NOW,
    lastActivityAt: NOW,
  })
})

test("duplicate bare busy retains its current epoch", () => {
  const current: SessionStatus = { type: "busy", since: 1, lastActivityAt: 2 }
  assert.deepEqual(nextSessionStatus(current, { type: "busy" }, NOW), current)
})

test("duplicate busy retains lifecycle evidence but accepts current running-tool state", () => {
  const current: SessionStatus = {
    type: "busy",
    since: 1,
    lastActivityAt: 2,
    runningTool: { title: "old", startedAt: 3 },
  }
  assert.deepEqual(nextSessionStatus(current, { type: "busy", runningTool: { title: "new", startedAt: 4 } }, NOW), {
    type: "busy",
    since: 1,
    lastActivityAt: 2,
    runningTool: { title: "new", startedAt: 4 },
  })
  assert.deepEqual(nextSessionStatus(current, { type: "busy" }, NOW), {
    type: "busy",
    since: 1,
    lastActivityAt: 2,
  })
})

test("completion followed by a fresh turn cannot reuse the prior turn epoch", () => {
  const prior: SessionStatus = { type: "busy", since: 1, lastActivityAt: 2 }
  const idle = nextSessionStatus(prior, { type: "idle" }, NOW - 1)
  assert.deepEqual(nextSessionStatus(idle, { type: "busy" }, NOW), {
    type: "busy",
    since: NOW,
    lastActivityAt: NOW,
  })
})

test("text activity advances only a current-turn busy status", () => {
  assert.deepEqual(noteTextActivity({ type: "busy", since: 1, lastActivityAt: 2 }, NOW), {
    type: "busy",
    since: 1,
    lastActivityAt: NOW,
  })
})

test("enriched server timestamps are retained", () => {
  const server: SessionStatus = { type: "busy", since: 3, lastActivityAt: 4 }
  assert.deepEqual(nextSessionStatus({ type: "idle" }, server, NOW), server)
})

test("restored bare busy has no activity evidence", () => {
  const restored: SessionStatus = { type: "busy" }
  assert.deepEqual(nextSessionStatus(restored, { type: "busy" }, NOW), restored)
})
