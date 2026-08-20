import { test } from "node:test"
import assert from "node:assert/strict"
import { slashPopoverQuery } from "./slash-trigger.ts"

const triggers = ["compact", "new", "review"]

test("typing a command shows the popover with the partial as query", () => {
  assert.equal(slashPopoverQuery("/", triggers), "")
  assert.equal(slashPopoverQuery("/com", triggers), "com")
})

test("a known command KEEPS the popover once arguments begin", () => {
  assert.equal(slashPopoverQuery("/review the auth flow", triggers), "review")
  assert.equal(slashPopoverQuery("/compact now please", triggers), "compact")
})

test("an unknown first token closes the popover at the first space", () => {
  assert.equal(slashPopoverQuery("/nope args", triggers), null)
})

test("non-slash input never triggers", () => {
  assert.equal(slashPopoverQuery("hello /compact", triggers), null)
  assert.equal(slashPopoverQuery("", triggers), null)
})
