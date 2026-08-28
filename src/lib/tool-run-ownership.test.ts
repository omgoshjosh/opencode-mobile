import assert from "node:assert/strict"
import test from "node:test"
import { ownsToolRunTranscript } from "./tool-run-ownership.ts"

test("tool runs render only for their route's selected session", () => {
  assert.equal(ownsToolRunTranscript("parent", "parent"), true)
  assert.equal(ownsToolRunTranscript("parent", "child"), false)
})

test("a stale direct link without an owner cannot render global parts", () => {
  assert.equal(ownsToolRunTranscript(undefined, "child"), false)
})
