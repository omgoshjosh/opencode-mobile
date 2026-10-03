// #55: composer draft autosave — debounce, flushes, and clear-only-after-accepted-send.
// Fake timers throughout; the controller is read through the module namespace so a
// run against a tree without it fails on assertions rather than on a missing export.
import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import * as lifecycle from "./draft-lifecycle.ts"

type Token = { sessionID: string; text: string }
type Autosave = {
  change: (sessionID: string, text: string) => void
  flush: () => void
  beginSend: (sessionID: string, text: string) => Token
  accepted: (token: Token) => void
}

let stored: Record<string, string>
let writes: Array<[string, string]>

function autosave(): Autosave {
  const create = (lifecycle as Record<string, unknown>).createDraftAutosave as ((deps: object) => Autosave) | undefined
  assert.equal(typeof create, "function", "createDraftAutosave exists")
  return create!({
    save: (sessionID: string, text: string) => {
      writes.push([sessionID, text])
      if (text.trim()) stored[sessionID] = text
      else delete stored[sessionID]
    },
    stored: (sessionID: string) => stored[sessionID],
  })
}

beforeEach(() => {
  stored = {}
  writes = []
  mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => mock.timers.reset())

test("#55 typing saves after a ~1 s debounce, once, with the latest text", () => {
  assert.equal((lifecycle as Record<string, unknown>).DRAFT_SAVE_DEBOUNCE_MS, 1000)
  const drafts = autosave()
  drafts.change("A", "h")
  mock.timers.tick(600)
  drafts.change("A", "hel")
  mock.timers.tick(999)
  assert.deepEqual(writes, [], "nothing written before 1 s of quiet")
  mock.timers.tick(1)
  assert.deepEqual(writes, [["A", "hel"]])
  mock.timers.tick(5000)
  assert.equal(writes.length, 1, "one write per quiet period")
})

test("#55 blur / background / navigation flushes the pending text immediately", () => {
  const drafts = autosave()
  drafts.change("A", "half a prompt")
  drafts.flush()
  assert.deepEqual(writes, [["A", "half a prompt"]])
  mock.timers.tick(2000)
  assert.equal(writes.length, 1, "the flushed debounce does not write again")
})

test("#55 a pending debounce for session A never writes into session B", () => {
  const drafts = autosave()
  drafts.change("A", "for A")
  drafts.change("B", "for B")
  assert.deepEqual(writes, [["A", "for A"]], "switching flushes A into A")
  mock.timers.tick(1000)
  assert.deepEqual(writes, [["A", "for A"], ["B", "for B"]])
  assert.deepEqual(stored, { A: "for A", B: "for B" })
})

test("#55 an accepted send clears the draft and no pending debounce resurrects it", () => {
  const drafts = autosave()
  drafts.change("A", "send me")
  const token = drafts.beginSend("A", "send me")
  assert.equal(stored.A, "send me", "durable while the send is in flight")
  drafts.accepted(token)
  mock.timers.tick(5000)
  assert.equal(stored.A, undefined)
})

test("#55 a failed send keeps the draft", () => {
  const drafts = autosave()
  drafts.change("A", "keep me")
  drafts.beginSend("A", "keep me")
  // No accepted() call: the POST failed or never happened.
  mock.timers.tick(5000)
  assert.equal(stored.A, "keep me")
})

test("#55 text typed while the send is in flight is never cleared", () => {
  // Accepted before the new text's debounce fires.
  let drafts = autosave()
  let token = drafts.beginSend("A", "first")
  drafts.change("A", "second thought")
  drafts.accepted(token)
  mock.timers.tick(1000)
  assert.equal(stored.A, "second thought")

  // Accepted after the new text was already saved.
  stored = {}
  drafts = autosave()
  token = drafts.beginSend("A", "first")
  drafts.change("A", "second thought")
  mock.timers.tick(1000)
  drafts.accepted(token)
  assert.equal(stored.A, "second thought")
})
