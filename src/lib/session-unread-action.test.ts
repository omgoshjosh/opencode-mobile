import { test } from "node:test"
import assert from "node:assert/strict"
import { unreadActionFor, unreadActionLabelKey } from "./session-unread-action.ts"

test("an unmarked session offers to mark it unread", () => {
  assert.equal(unreadActionFor({ marked: false, supported: true }), "markUnread")
})

test("a marked session offers the way back out", () => {
  assert.equal(unreadActionFor({ marked: true, supported: true }), "markRead")
})

// An old daemon has no route to write to. Offering a greyed-out item would
// invite the user to wonder what they did wrong.
test("an unsupported connection offers nothing at all, marked or not", () => {
  assert.equal(unreadActionFor({ marked: false, supported: false }), null)
  assert.equal(unreadActionFor({ marked: true, supported: false }), null)
})

test("each action has its own label key", () => {
  assert.equal(unreadActionLabelKey("markUnread"), "sessionsList.actions.markUnread")
  assert.equal(unreadActionLabelKey("markRead"), "sessionsList.actions.markRead")
})
