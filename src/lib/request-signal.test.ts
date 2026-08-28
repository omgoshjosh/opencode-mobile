import { test } from "node:test"
import assert from "node:assert/strict"
import { requestSignal } from "./request-signal.ts"

test("caller abort cancels the request signal before its timeout", () => {
  const caller = new AbortController()
  const request = requestSignal(caller.signal, 30_000)

  caller.abort()

  assert.equal(request.signal.aborted, true)
  assert.equal(request.timedOut(), false)
  request.dispose()
})

test("timeout still cancels a request without a caller abort", async () => {
  const request = requestSignal(undefined, 1)
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.equal(request.signal.aborted, true)
  assert.equal(request.timedOut(), true)
  request.dispose()
})

test("an already-aborted caller does not start a request", () => {
  const caller = new AbortController()
  caller.abort()

  assert.throws(() => requestSignal(caller.signal, 30_000), /Request aborted/)
})
