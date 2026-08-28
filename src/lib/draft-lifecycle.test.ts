import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldApplyRestoredDraft, shouldPersistFocusedDraft } from "./draft-lifecycle.ts"

test("only a focused, restored composer persists a changed draft", () => {
  assert.equal(shouldPersistFocusedDraft(false, true, "draft", "updated"), false)
  assert.equal(shouldPersistFocusedDraft(true, false, "draft", ""), false)
  assert.equal(shouldPersistFocusedDraft(true, true, "draft", "draft"), false)
  assert.equal(shouldPersistFocusedDraft(true, true, "draft", "updated"), true)
})

test("a typed composer wins over delayed draft restoration", () => {
  assert.equal(shouldApplyRestoredDraft(false, false), false)
  assert.equal(shouldApplyRestoredDraft(true, true), false)
  assert.equal(shouldApplyRestoredDraft(true, false), true)
})
