import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applyServerState,
  dropReadState,
  isMarkedUnread,
  optimisticMarkRead,
  optimisticMarkUnread,
  parseReadState,
  revisionFor,
  serializeReadState,
  type ReadStateMap,
} from "./session-read-state.ts"

// --- folding server state in ---

test("a marked state lands with its revision", () => {
  const next = applyServerState({}, { sessionID: "s1", markedUnreadAt: 500, timeUpdated: 500 })
  assert.deepEqual(next, { s1: { revision: 500, markedUnreadAt: 500 } })
  assert.equal(isMarkedUnread(next, "s1"), true)
})

test("state with no markedUnreadAt means not marked", () => {
  const next = applyServerState({ s1: { revision: 100, markedUnreadAt: 100 } }, { sessionID: "s1", timeUpdated: 200 })
  assert.deepEqual(next, { s1: { revision: 200 } })
  assert.equal(isMarkedUnread(next, "s1"), false)
})

// The response to our own PATCH and the SSE event for that same PATCH carry
// identical state and race each other. Whichever arrives second must be a
// no-op, not a flicker.
test("replaying the same revision is idempotent and keeps the identity", () => {
  const map: ReadStateMap = { s1: { revision: 700, markedUnreadAt: 700 } }
  const next = applyServerState(map, { sessionID: "s1", markedUnreadAt: 700, timeUpdated: 700 })
  assert.equal(next, map)
})

test("a state older than the one held is a late echo and is ignored", () => {
  const map: ReadStateMap = { s1: { revision: 900, markedUnreadAt: 900 } }
  assert.equal(applyServerState(map, { sessionID: "s1", timeUpdated: 400 }), map)
  assert.equal(isMarkedUnread(map, "s1"), true)
})

test("a newer state wins even when it clears the mark", () => {
  const map: ReadStateMap = { s1: { revision: 900, markedUnreadAt: 900 } }
  assert.deepEqual(applyServerState(map, { sessionID: "s1", timeUpdated: 1000 }), { s1: { revision: 1000 } })
})

test("malformed states are dropped rather than trusted into a comparison", () => {
  const map: ReadStateMap = { s1: { revision: 5 } }
  assert.equal(applyServerState(map, { sessionID: "", timeUpdated: 9 } as never), map)
  assert.equal(applyServerState(map, { sessionID: "s2", timeUpdated: Number.NaN }), map)
  assert.equal(applyServerState(map, { sessionID: "s2", timeUpdated: -1 }), map)
})

test("a nonsense markedUnreadAt reads as unmarked instead of poisoning the row", () => {
  const next = applyServerState({}, { sessionID: "s1", markedUnreadAt: Number.NaN, timeUpdated: 10 })
  assert.deepEqual(next, { s1: { revision: 10 } })
})

// --- optimistic overlay ---

// The revision belongs to the server. Inventing one locally would make the
// NEXT write's expectedRevision a lie, and the server would silently drop it.
test("marking optimistically shows the mark but does not invent a revision", () => {
  const next = optimisticMarkUnread({ s1: { revision: 300 } }, "s1", 12345)
  assert.deepEqual(next, { s1: { revision: 300, markedUnreadAt: 12345 } })
  assert.equal(revisionFor(next, "s1"), 300)
})

test("marking a session we have never seen state for starts at revision 0", () => {
  assert.deepEqual(optimisticMarkUnread({}, "s1", 42), { s1: { revision: 0, markedUnreadAt: 42 } })
  assert.equal(revisionFor({}, "unknown"), 0)
})

test("the server's echo replaces the optimistic entry wholesale", () => {
  const optimistic = optimisticMarkUnread({ s1: { revision: 300 } }, "s1", 12345)
  const settled = applyServerState(optimistic, { sessionID: "s1", markedUnreadAt: 999, timeUpdated: 999 })
  assert.deepEqual(settled, { s1: { revision: 999, markedUnreadAt: 999 } })
})

test("clearing optimistically drops only the mark, keeping the revision", () => {
  assert.deepEqual(optimisticMarkRead({ s1: { revision: 300, markedUnreadAt: 400 } }, "s1"), { s1: { revision: 300 } })
})

test("clearing an unmarked session is a no-op", () => {
  const map: ReadStateMap = { s1: { revision: 300 } }
  assert.equal(optimisticMarkRead(map, "s1"), map)
  assert.equal(optimisticMarkRead(map, "missing"), map)
})

test("dropping forgets a deleted session", () => {
  const map: ReadStateMap = { s1: { revision: 1 }, s2: { revision: 2 } }
  assert.deepEqual(dropReadState(map, "s1"), { s2: { revision: 2 } })
  assert.equal(dropReadState(map, "missing"), map)
})

// --- persistence ---

test("a serialized map round-trips", () => {
  const map: ReadStateMap = { s1: { revision: 10, markedUnreadAt: 10 }, s2: { revision: 20 } }
  assert.deepEqual(parseReadState(serializeReadState(map)), map)
})

// The server is authoritative, so a corrupt cache should cost a frame of stale
// marks -- never a crash on launch.
test("a corrupt cache reads as empty instead of throwing", () => {
  assert.deepEqual(parseReadState("not json"), {})
  assert.deepEqual(parseReadState("[1,2,3]"), {})
  assert.deepEqual(parseReadState("null"), {})
  assert.deepEqual(parseReadState(null), {})
  assert.deepEqual(parseReadState(""), {})
})

test("individually malformed entries are skipped, not fatal to the whole cache", () => {
  const raw = JSON.stringify({
    good: { revision: 5, markedUnreadAt: 5 },
    noRevision: { markedUnreadAt: 5 },
    stringRevision: { revision: "5" },
    negative: { revision: -1 },
    notAnObject: 7,
    arrayEntry: [1],
    badMark: { revision: 8, markedUnreadAt: "soon" },
  })
  assert.deepEqual(parseReadState(raw), { good: { revision: 5, markedUnreadAt: 5 }, badMark: { revision: 8 } })
})
