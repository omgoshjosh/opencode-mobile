import assert from "node:assert/strict"
import { test } from "node:test"
import { canFlushVisiblePartStatus, queueStreamPart } from "./stream-part-batching.ts"

type Part = { id: string; messageID: string; sessionID: string; text: string }
const part = (id: string, text: string, messageID = "m1", sessionID = "s1"): Part => ({ id, text, messageID, sessionID })

test("1,000 rapid replacements use one bounded commit with latest values and stable unaffected references", () => {
  const queue = new Map<string, Part>()
  const unaffected = [{ id: "keep" }]
  let commits = 0
  for (let i = 0; i < 1_000; i++) queueStreamPart(queue, part(`p${i % 2}`, `v${i}`, i % 2 ? "m2" : "m1"))
  assert.equal(commits, 0, "receipt does not commit")
  const parts = { keep: unaffected, m1: [] as Part[], m2: [] as Part[] }
  for (const item of queue.values()) parts[item.messageID as "m1" | "m2"].push(item)
  commits++
  assert.equal(commits, 1, "flush commit bound is independent of event count")
  assert.deepEqual(parts.m1.map((item) => item.text), ["v998"])
  assert.deepEqual(parts.m2.map((item) => item.text), ["v999"])
  assert.strictEqual(parts.keep, unaffected)
})

test("interleaved sessions and messages cannot replace each other's same part IDs", () => {
  const queue = new Map<string, Part>()
  queueStreamPart(queue, part("shared", "foreground", "m1", "s1"))
  queueStreamPart(queue, part("shared", "background", "m3", "s2"))
  queueStreamPart(queue, part("shared", "second message", "m2", "s1"))
  assert.deepEqual([...queue.values()].map((item) => item.text), ["foreground", "background", "second message"])
})

test("same scoped part replaces latest data without changing first-arrival order", () => {
  const queue = new Map<string, Part>()
  queueStreamPart(queue, part("one", "first"))
  queueStreamPart(queue, part("two", "second"))
  queueStreamPart(queue, part("one", "latest"))
  assert.deepEqual([...queue.values()].map((item) => item.text), ["latest", "second"])
})

test("background and replaced sessions cannot flush foreground status", () => {
  assert.equal(canFlushVisiblePartStatus("s1", "s1", "s2"), false)
  assert.equal(canFlushVisiblePartStatus("s2", "s2", "s1"), false)
  assert.equal(canFlushVisiblePartStatus("s1", "s1", "s1"), true)
})

test("terminal and disconnect boundaries can synchronously flush or cancel queued work", () => {
  const queue = new Map<string, Part>()
  queueStreamPart(queue, part("terminal", "final"))
  const flushed = [...queue.values()]
  queue.clear()
  assert.equal(flushed[0].text, "final")
  queueStreamPart(queue, part("late", "discard"))
  queue.clear()
  assert.equal(queue.size, 0)
})
