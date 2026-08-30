import { test } from "node:test"
import assert from "node:assert/strict"
import { createOpenTranscriptReconciler } from "./open-transcript-reconcile.ts"

test("reconnect and open-session refresh share one bounded request", async () => {
  const reconcile = createOpenTranscriptReconciler()
  let calls = 0
  let resolve: (() => void) | undefined
  const work = () => {
    calls++
    return new Promise<void>((done) => {
      resolve = done
    })
  }

  const reconnect = reconcile.run("s1", work)
  const idle = reconcile.run("s1", work)
  assert.equal(calls, 1)
  resolve!()
  await Promise.all([reconnect, idle])

  await reconcile.run("s1", async () => {
    calls++
  })
  assert.equal(calls, 2)
})
