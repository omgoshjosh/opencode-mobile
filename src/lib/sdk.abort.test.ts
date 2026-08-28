import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "./sdk.ts"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("focus reads pass a caller abort signal to their requests", async () => {
  const signals: AbortSignal[] = []
  globalThis.fetch = async (_input, init) => {
    signals.push(init!.signal as AbortSignal)
    return new Response(JSON.stringify([]), { status: 200 })
  }

  const client = createClient({ baseUrl: "http://example.test" })
  const controller = new AbortController()

  await client.session.get("session", controller.signal)
  await client.session.messages("session", undefined, controller.signal)
  await client.session.messagesPage("session", { limit: 50 }, controller.signal)
  await client.permission.list(controller.signal)
  await client.question.list(controller.signal)

  assert.equal(signals.length, 5)
  for (const signal of signals) assert.ok(signal)
})

test("aborting a focus read rejects without waiting for its request timeout", async () => {
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
    })

  const client = createClient({ baseUrl: "http://example.test" })
  const controller = new AbortController()
  const pending = client.session.messagesPage("session", { limit: 50 }, controller.signal)
  controller.abort()

  await assert.rejects(pending, { name: "AbortError" })
})
