import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldApplyRestoredDraft, shouldPersistFocusedDraft } from "./draft-lifecycle.ts"

test("only a focused composer persists a changed draft", () => {
  assert.equal(shouldPersistFocusedDraft(false, true, true, "draft", "updated"), false)
  assert.equal(shouldPersistFocusedDraft(true, false, false, "draft", ""), false)
  assert.equal(shouldPersistFocusedDraft(true, true, false, "draft", "draft"), false)
  assert.equal(shouldPersistFocusedDraft(true, true, false, "draft", "updated"), true)
})

test("typed input saves before delayed draft restoration", () => {
  assert.equal(shouldPersistFocusedDraft(true, false, true, "saved draft", "new input"), true)
  assert.equal(shouldPersistFocusedDraft(true, false, false, "saved draft", ""), false)
})

test("a typed composer wins over delayed draft restoration", () => {
  assert.equal(shouldApplyRestoredDraft(false, false), false)
  assert.equal(shouldApplyRestoredDraft(true, true), false)
  assert.equal(shouldApplyRestoredDraft(true, false), true)
})
