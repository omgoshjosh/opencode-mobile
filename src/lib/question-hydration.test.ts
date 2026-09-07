import { test } from "node:test"
import assert from "node:assert/strict"
import { indexQuestionsBySession, mergeQuestionSnapshot, observableSessionIDs } from "./question-hydration.ts"

const question = (id: string, sessionID: string) => ({ id, sessionID })
/** The existing race tests predate scoping; they only care about the merge. */
const anywhere = { has: () => true } as unknown as ReadonlySet<string>

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
  const merged = mergeQuestionSnapshot([question("q1", "child-a")], { added: [], removed: [] }, anywhere)
  assert.deepEqual(Object.keys(merged), ["child-a"])
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q1"])
})

test("a question that arrived while the GET was in flight survives the snapshot", () => {
  const merged = mergeQuestionSnapshot([question("q1", "child-a")], { added: [question("q2", "child-b")], removed: [] }, anywhere)
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q1"])
  assert.deepEqual(merged["child-b"]!.map((q) => q.id), ["q2"])
})

test("a reply or rejection in flight beats a snapshot that still lists it pending", () => {
  const merged = mergeQuestionSnapshot([question("q1", "child-a"), question("q2", "child-a")], { added: [], removed: ["q1"] }, anywhere)
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q2"])
})

test("an in-flight arrival already present in the snapshot is not duplicated", () => {
  const merged = mergeQuestionSnapshot([question("q1", "child-a")], { added: [question("q1", "child-a")], removed: [] }, anywhere)
  assert.deepEqual(merged["child-a"]!.map((q) => q.id), ["q1"])
})

test("an arrival that was immediately resolved never lands", () => {
  const merged = mergeQuestionSnapshot([], { added: [question("q1", "child-a")], removed: ["q1"] }, anywhere)
  assert.deepEqual(merged, {})
})

// --- the snapshot is global, the bus that clears it is not (#44) ---

test("observable sessions are the connected directory's, plus the workers they report", () => {
  const observable = observableSessionIDs([
    { id: "here", directory: "/proj", workers: ["worker-1", "worker-2"] },
    { id: "elsewhere", directory: "/other", workers: ["worker-3"] },
    { id: "unknown-dir", workers: ["worker-4"] },
  ], "/proj")
  assert.deepEqual([...observable].sort(), ["here", "unknown-dir", "worker-1", "worker-2", "worker-4"])
})

test("without a connection directory nothing can be ruled out", () => {
  // The daemon picked the scope for us, so the client has nothing to compare
  // against and must not invent an exclusion.
  const observable = observableSessionIDs([{ id: "a", directory: "/x" }, { id: "b", directory: "/y" }], undefined)
  assert.deepEqual([...observable].sort(), ["a", "b"])
})

test("a snapshot question for an unobservable session is not retained", () => {
  // `GET /question` is global; `question.replied`/`rejected` are only forwarded
  // for the connected directory. Keeping this entry would pin its worker at
  // "needs input" for the life of the connection, with no event able to clear it.
  const observable = observableSessionIDs([{ id: "parent", directory: "/proj", workers: ["mine"] }], "/proj")
  const merged = mergeQuestionSnapshot(
    [question("q1", "mine"), question("q2", "theirs")],
    { added: [], removed: [] },
    observable,
  )
  assert.deepEqual(Object.keys(merged), ["mine"])
  assert.deepEqual(merged["mine"]!.map((q) => q.id), ["q1"])
})

test("an in-flight arrival is kept even for a session the tracked set has not caught up to", () => {
  // It came off the directory-scoped bus, so the server already vouched for it.
  const merged = mergeQuestionSnapshot([], { added: [question("q1", "brand-new")], removed: [] }, new Set<string>())
  assert.deepEqual(merged["brand-new"]!.map((q) => q.id), ["q1"])
})
