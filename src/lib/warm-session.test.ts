import assert from "node:assert/strict"
import test from "node:test"
import { warmSessionFor } from "./warm-session.ts"

const sessions = [{ id: "session-a", title: "A" }, { id: "session-b", title: "B" }]

test("a cached transcript binds to its matching list session before the GET", () => {
  assert.deepEqual(warmSessionFor(sessions, "session-b", true), sessions[1])
})

test("cold and missing sessions do not fabricate metadata", () => {
  assert.equal(warmSessionFor(sessions, "session-b", false), undefined)
  assert.equal(warmSessionFor(sessions, "missing", true), undefined)
})
