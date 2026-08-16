import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_CACHED_MESSAGES,
  MAX_CACHED_SESSIONS,
  canRenderFromCache,
  capTranscript,
  dropTranscript,
  getTranscript,
  putTranscript,
  type TranscriptCache,
} from "./transcript-cache.ts"
import type { Message, Part } from "./sdk.ts"

function msg(id: string): Message {
  return { id, sessionID: "s", role: "user", time: { created: 1 } }
}
function part(messageID: string): Part {
  return { id: `p-${messageID}`, messageID, type: "text", text: "x" }
}
function transcript(n: number, offset = 0) {
  const messages = Array.from({ length: n }, (_, i) => msg(`m${i + offset}`))
  const parts = Object.fromEntries(messages.map((m) => [m.id, [part(m.id)]]))
  return { messages, parts }
}

// --- capping ---

test("a short transcript is kept whole", () => {
  const { messages, parts } = capTranscript({ ...transcript(3) })
  assert.equal(messages.length, 3)
  assert.equal(Object.keys(parts).length, 3)
})

test("a long transcript keeps the newest messages", () => {
  const { messages } = capTranscript({ ...transcript(100), max: 10 })
  assert.equal(messages.length, 10)
  assert.equal(messages[0].id, "m90")
  assert.equal(messages.at(-1)!.id, "m99")
})

// Parts outnumber messages ~5:1 here, so dropping messages without pruning
// parts would leak the bulkier half.
test("parts of dropped messages are pruned", () => {
  const { parts } = capTranscript({ ...transcript(100), max: 10 })
  assert.equal(Object.keys(parts).length, 10)
  assert.equal(parts.m0, undefined)
  assert.ok(parts.m99)
})

test("capping tolerates missing parts", () => {
  const { messages, parts } = capTranscript({ messages: [msg("a")], parts: {} })
  assert.equal(messages.length, 1)
  assert.deepEqual(parts, {})
})

// --- put / evict ---

test("an entry can be read back", () => {
  const cache = putTranscript({}, "s1", { ...transcript(2) }, 1000)
  assert.equal(getTranscript(cache, "s1")?.messages.length, 2)
})

test("the cursor survives so a restored session can keep paging", () => {
  const cache = putTranscript({}, "s1", { ...transcript(2), nextCursor: "cur" }, 1000)
  assert.equal(getTranscript(cache, "s1")?.nextCursor, "cur")
})

test("entries are capped on the way in", () => {
  const cache = putTranscript({}, "s1", { ...transcript(500) }, 1000)
  assert.equal(getTranscript(cache, "s1")!.messages.length, MAX_CACHED_MESSAGES)
})

test("the cache holds at most MAX_CACHED_SESSIONS", () => {
  let cache: TranscriptCache = {}
  for (let i = 0; i < MAX_CACHED_SESSIONS + 3; i++) {
    cache = putTranscript(cache, `s${i}`, { ...transcript(2) }, 1000 + i)
  }
  assert.equal(Object.keys(cache).length, MAX_CACHED_SESSIONS)
})

test("the least recently touched is evicted first", () => {
  let cache: TranscriptCache = {}
  for (let i = 0; i < MAX_CACHED_SESSIONS; i++) {
    cache = putTranscript(cache, `s${i}`, { ...transcript(2) }, 1000 + i)
  }
  cache = putTranscript(cache, "new", { ...transcript(2) }, 9999)
  assert.equal(getTranscript(cache, "s0"), undefined, "oldest should be gone")
  assert.ok(getTranscript(cache, "new"))
})

// The entry just written is newest by construction.
test("writing never evicts the session being written", () => {
  let cache: TranscriptCache = {}
  for (let i = 0; i < MAX_CACHED_SESSIONS + 5; i++) {
    cache = putTranscript(cache, `s${i}`, { ...transcript(2) }, 1000 + i)
    assert.ok(getTranscript(cache, `s${i}`), `s${i} evicted itself`)
  }
})

test("re-touching a session protects it from eviction", () => {
  let cache: TranscriptCache = {}
  for (let i = 0; i < MAX_CACHED_SESSIONS; i++) {
    cache = putTranscript(cache, `s${i}`, { ...transcript(2) }, 1000 + i)
  }
  cache = putTranscript(cache, "s0", { ...transcript(2) }, 5000) // refresh oldest
  cache = putTranscript(cache, "new", { ...transcript(2) }, 6000)
  assert.ok(getTranscript(cache, "s0"), "refreshed entry should survive")
  assert.equal(getTranscript(cache, "s1"), undefined)
})

test("an empty session id is ignored rather than cached under one", () => {
  assert.deepEqual(putTranscript({}, "", { ...transcript(1) }), {})
})

test("put does not mutate the cache it was given", () => {
  const original: TranscriptCache = {}
  putTranscript(original, "s1", { ...transcript(1) })
  assert.deepEqual(original, {})
})

// --- drop ---

test("dropping removes one entry and leaves the rest", () => {
  let cache = putTranscript({}, "s1", { ...transcript(1) })
  cache = putTranscript(cache, "s2", { ...transcript(1) })
  const next = dropTranscript(cache, "s1")
  assert.equal(getTranscript(next, "s1"), undefined)
  assert.ok(getTranscript(next, "s2"))
})

test("dropping an absent entry is a no-op", () => {
  const cache = putTranscript({}, "s1", { ...transcript(1) })
  assert.equal(dropTranscript(cache, "nope"), cache)
})

// --- render gate ---

test("a populated entry can be rendered immediately", () => {
  const cache = putTranscript({}, "s1", { ...transcript(2) })
  assert.equal(canRenderFromCache(getTranscript(cache, "s1")), true)
})

test("an empty or missing entry cannot", () => {
  assert.equal(canRenderFromCache(undefined), false)
  const cache = putTranscript({}, "s1", { messages: [], parts: {} })
  assert.equal(canRenderFromCache(getTranscript(cache, "s1")), false)
})
