import { test } from "node:test"
import assert from "node:assert/strict"
import { canRefreshPending, createFocusReadCoordinator } from "./focus-read.ts"

test("an aborted focus selection cannot commit or refresh pending state", () => {
  const caller = new AbortController()
  const reads = createFocusReadCoordinator()
  const read = reads.begin(caller.signal)

  caller.abort()

  assert.equal(read.isCurrent(), false, "sessions store must discard the aborted read")
  assert.equal(canRefreshPending(caller.signal, "session-a", "session-a"), false, "events store must not start pending refresh")
})

test("a newer selection makes an older selection stale", () => {
  const reads = createFocusReadCoordinator()
  const first = reads.begin()
  const second = reads.begin()

  assert.equal(first.isCurrent(), false, "stale response cannot commit to sessions store")
  assert.equal(second.isCurrent(), true)
  assert.equal(canRefreshPending(undefined, "session-b", "session-a"), false, "stale session cannot commit pending state")
  second.dispose()
})
