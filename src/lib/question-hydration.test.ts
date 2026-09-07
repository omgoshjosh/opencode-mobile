import { test } from "node:test"
import assert from "node:assert/strict"
import { indexQuestionsBySession, mergeQuestionSnapshot } from "./question-hydration.ts"

const question = (id: string, sessionID: string) => ({ id, sessionID })

test("a GET /question list is grouped by the session that is blocked on it", () => {
  const indexed = indexQuestionsBySession([question("q1", "child-a"), question("q2", "child-b"), question("q3", "child-a")])
  assert.deepEqual(Object.keys(indexed).sort(), ["child-a", "child-b"])
  assert.deepEqual(indexed["child-a"]!.map((q) => q.id), ["q1", "q3"])
})

test("malformed entries are dropped rather than keyed under undefined", () => {
  assert.deepEqual(indexQuestionsBySession([{ id: "q1", sessionID: "" }, { id: "", sessionID: "child" }] as never), {})
  assert.deepEqual(indexQuestionsBySession(null), {})
})

test("the snapshot replaces the map, so a question answered while offline does not linger", () => {
  // There is no `question.replied` to replay: SSE resumes from "now". A union
  // with the previous map would keep the stale entry pending forever.
  const merged = mergeQuestionSnapshot([question("q1", "child-a")], { added: [], removed: [] })
  assert.deepEqual(Object.keys(merged), ["child-a"])
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q1"])
})

test("a question that arrived while the GET was in flight survives the snapshot", () => {
  const merged = mergeQuestionSnapshot([question("q1", "child-a")], { added: [question("q2", "child-b")], removed: [] })
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q1"])
  assert.deepEqual(merged["child-b"]!.map((q) => q.id), ["q2"])
})

test("a reply or rejection in flight beats a snapshot that still lists it pending", () => {
  const merged = mergeQuestionSnapshot([question("q1", "child-a"), question("q2", "child-a")], { added: [], removed: ["q1"] })
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q2"])
})

test("an in-flight arrival already present in the snapshot is not duplicated", () => {
  const merged = mergeQuestionSnapshot([question("q1", "child-a")], { added: [question("q1", "child-a")], removed: [] })
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q1"])
})

test("an arrival that was immediately resolved never lands", () => {
  const merged = mergeQuestionSnapshot([], { added: [question("q1", "child-a")], removed: ["q1"] })
  assert.deepEqual(merged, {})
})
