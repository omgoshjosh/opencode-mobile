import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "./api-error.ts"
import { createMessageTransport } from "./message-transport.ts"
import { transcriptPageParams } from "./message-page.ts"

interface Call {
  path: string
  options: RequestInit | undefined
  sampleLatency: boolean | undefined
}

function transport(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Call[] = []
  const request = async <T>(path: string, options?: RequestInit, sampleLatency?: boolean) => {
    calls.push({ path, options, sampleLatency })
    const response = responses[calls.length - 1] ?? { body: [] }
    if (response.status) throw new ApiError(response.status, `HTTP ${response.status}`)
    return { body: (response.body ?? []) as T, headers: new Headers() }
  }
  return { client: createMessageTransport(request), calls }
}

test("budgeted messagesPage emits limit, cursor, render budget, and part budget", async () => {
  const { client, calls } = transport([{ body: [] }])
  const signal = new AbortController().signal

  await client.messagesPage("session id", transcriptPageParams(50, "opaque+/="), signal)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, "/session/session id/message?limit=50&before=opaque%2B%2F%3D&renderBudget=40000&partBudget=4000")
  assert.equal(calls[0].options?.signal, signal)
})

for (const status of [400, 404]) {
  test(`messagesPage retries one time without partBudget after ${status}`, async () => {
    const { client, calls } = transport([{ status }, { body: [] }])

    await client.messagesPage("s1", transcriptPageParams(25))

    assert.equal(calls.length, 2)
    assert.equal(calls[0].path, "/session/s1/message?limit=25&renderBudget=40000&partBudget=4000")
    assert.equal(calls[1].path, "/session/s1/message?limit=25&renderBudget=40000")
    assert.equal(calls[1].sampleLatency, false)
  })
}

for (const status of [401, 500]) {
  test(`messagesPage does not retry ${status}`, async () => {
    const { client, calls } = transport([{ status }])

    await assert.rejects(() => client.messagesPage("s1", transcriptPageParams(25)), ApiError)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].path, "/session/s1/message?limit=25&renderBudget=40000&partBudget=4000")
  })
}

test("learned unsupported partBudget omits it on later requests", async () => {
  const { client, calls } = transport([{ status: 400 }, { body: [] }, { body: [] }])

  await client.messagesPage("s1", transcriptPageParams(25))
  await client.messagesPage("s1", transcriptPageParams(25, "older"))

  assert.equal(calls.length, 3)
  assert.equal(calls[2].path, "/session/s1/message?limit=25&before=older&renderBudget=40000")
})

test("full-output lookup emits one unbudgeted single-message request", async () => {
  const { client, calls } = transport([{ body: { info: {}, parts: [] } }])
  const signal = new AbortController().signal

  await client.message("s1", "m1", signal)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, "/session/s1/message/m1")
  assert.equal(calls[0].options?.signal, signal)
})
