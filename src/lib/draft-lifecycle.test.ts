import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldPersistFocusedDraft } from "./draft-lifecycle.ts"

test("only a focused, restored composer persists a changed draft", () => {
  assert.equal(shouldPersistFocusedDraft(false, true, "draft", "updated"), false)
  assert.equal(shouldPersistFocusedDraft(true, false, "draft", ""), false)
  assert.equal(shouldPersistFocusedDraft(true, true, "draft", "draft"), false)
  assert.equal(shouldPersistFocusedDraft(true, true, "draft", "updated"), true)
})
