import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_DRAFTS, parseDrafts, putDraft } from "./draft-store.ts"

test("a draft is stored and an emptied composer deletes it", () => {
  let map = putDraft({}, "s1", "half a thought", 100)
  assert.equal(map.s1.text, "half a thought")
  map = putDraft(map, "s1", "   ", 200)
  assert.equal(map.s1, undefined)
})

test("the oldest drafts fall off past the cap", () => {
  let map = {}
  for (let i = 0; i < MAX_DRAFTS + 5; i++) map = putDraft(map, `s${i}`, `draft ${i}`, i)
  assert.equal(Object.keys(map).length, MAX_DRAFTS)
  assert.equal(map.s0, undefined)
  assert.ok(map[`s${MAX_DRAFTS + 4}`])
})

test("corrupt storage parses to empty, never throws", () => {
  assert.deepEqual(parseDrafts(null), {})
  assert.deepEqual(parseDrafts("not json"), {})
  assert.deepEqual(parseDrafts('{"s1": {"text": 42}}'), {})
  assert.deepEqual(parseDrafts('{"s1": {"text": "ok", "at": 1}}'), { s1: { text: "ok", at: 1 } })
})
