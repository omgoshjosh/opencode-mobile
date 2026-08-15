import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_GROUP_MODE,
  UNGROUPED_KEY,
  dateBucket,
  groupKey,
  groupSortIndex,
  isGroupMode,
} from "./session-group-modes.ts"

const NOW = new Date("2026-08-15T14:00:00").getTime()
const ctx = { nowMs: NOW }
const day = 24 * 60 * 60 * 1000

test("directory grouping keeps existing behaviour", () => {
  assert.equal(groupKey({ id: "s1", directory: "/Users/josh/agents" }, "directory", ctx), "/Users/josh/agents")
})

test("a session with no directory is ungrouped, not crashed", () => {
  assert.equal(groupKey({ id: "s1" }, "directory", ctx), UNGROUPED_KEY)
})

test("swarm grouping keys on the swarm id", () => {
  const s = { id: "s1", model: { providerID: "swarm", id: "swm_1" } }
  assert.equal(groupKey(s, "swarm", ctx), "swm_1")
})

test("a non-swarm session is ungrouped under swarm mode", () => {
  const s = { id: "s1", model: { providerID: "openai", id: "gpt-5.6-sol" } }
  assert.equal(groupKey(s, "swarm", ctx), UNGROUPED_KEY)
})

// The point of the "root" mode: it produces the nested view without a tree.
test("root mode puts children in the same bucket as their parent", () => {
  const parent = { id: "ses_root" }
  const child = { id: "ses_child", parentID: "ses_root" }
  assert.equal(groupKey(parent, "root", ctx), "ses_root")
  assert.equal(groupKey(child, "root", ctx), "ses_root")
})

test("root mode leaves unrelated roots in their own buckets", () => {
  assert.notEqual(groupKey({ id: "a" }, "root", ctx), groupKey({ id: "b" }, "root", ctx))
})

test("date buckets are coarse and ordered", () => {
  assert.equal(dateBucket(NOW, NOW), "Today")
  assert.equal(dateBucket(NOW - day, NOW), "Yesterday")
  assert.equal(dateBucket(NOW - 3 * day, NOW), "This week")
  assert.equal(dateBucket(NOW - 15 * day, NOW), "This month")
  assert.equal(dateBucket(NOW - 200 * day, NOW), "Older")
  assert.equal(dateBucket(undefined, NOW), UNGROUPED_KEY)
})

test("status grouping uses the supplied status, defaulting to idle", () => {
  const statusOf = (id: string) => (id === "busy1" ? "busy" : undefined)
  assert.equal(groupKey({ id: "busy1" }, "status", { nowMs: NOW, statusOf }), "busy")
  assert.equal(groupKey({ id: "other" }, "status", { nowMs: NOW, statusOf }), "idle")
})

test("ungrouped always sorts last", () => {
  assert.ok(groupSortIndex(UNGROUPED_KEY, "directory") > groupSortIndex("/anything", "directory"))
  assert.ok(groupSortIndex(UNGROUPED_KEY, "status") > groupSortIndex("idle", "status"))
})

test("status groups order busy before retry before idle", () => {
  assert.ok(groupSortIndex("busy", "status") < groupSortIndex("retry", "status"))
  assert.ok(groupSortIndex("retry", "status") < groupSortIndex("idle", "status"))
})

test("date groups order newest bucket first", () => {
  assert.ok(groupSortIndex("Today", "date") < groupSortIndex("Yesterday", "date"))
  assert.ok(groupSortIndex("Yesterday", "date") < groupSortIndex("Older", "date"))
})

test("directory and swarm keep first-seen order (no imposed sort)", () => {
  assert.equal(groupSortIndex("/a", "directory"), groupSortIndex("/b", "directory"))
  assert.equal(groupSortIndex("swm_1", "swarm"), groupSortIndex("swm_2", "swarm"))
})

// Drift guard for the deliberately-duplicated provider id.
test("swarm provider id matches swarm-model's", async () => {
  const { SWARM_PROVIDER_ID } = await import("./swarm-model.ts")
  const s = { id: "s1", model: { providerID: SWARM_PROVIDER_ID, id: "swm_1" } }
  assert.equal(groupKey(s, "swarm", ctx), "swm_1")
})

test("isGroupMode validates persisted values", () => {
  assert.equal(isGroupMode("swarm"), true)
  assert.equal(isGroupMode("nonsense"), false)
  assert.equal(isGroupMode(undefined), false)
  assert.equal(isGroupMode(DEFAULT_GROUP_MODE), true)
})
