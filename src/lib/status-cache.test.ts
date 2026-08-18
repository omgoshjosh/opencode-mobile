import { test } from "node:test"
import assert from "node:assert/strict"
import { parseStatusCache, toStatusCache } from "./status-cache.ts"

test("only busy and retry survive into the cache", () => {
  const cache = toStatusCache({
    a: { type: "busy" },
    b: { type: "idle" },
    c: { type: "retry" },
  })
  assert.deepEqual(cache, { a: { type: "busy" }, c: { type: "busy" } })
})

test("an all-idle map persists as empty", () => {
  assert.deepEqual(toStatusCache({ a: { type: "idle" } }), {})
})

test("corrupt storage parses to empty, never throws", () => {
  assert.deepEqual(parseStatusCache(null), {})
  assert.deepEqual(parseStatusCache("nope"), {})
  assert.deepEqual(parseStatusCache('{"a":{"type":"exploded"}}'), {})
  assert.deepEqual(parseStatusCache('{"a":{"type":"retry"}}'), {})
  assert.deepEqual(parseStatusCache('{"a":{"type":"busy"}}'), { a: { type: "busy" } })
})
