import assert from "node:assert/strict"
import { afterEach, before, mock, test } from "node:test"

mock.module("expo/fetch", { namedExports: { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) } })
mock.module("expo-application", { namedExports: { nativeApplicationVersion: "0.0.0", nativeBuildVersion: "0" } })
mock.module("react-native", { namedExports: { Platform: { OS: "ios" } } })

let createClient: typeof import("./sdk").createClient
const originalFetch = globalThis.fetch

before(async () => {
  ;({ createClient } = await import("./sdk"))
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("an update PATCHes the session-state route and returns the server's state", async () => {
  let seen: { url: string; method?: string; body?: unknown } | undefined
  globalThis.fetch = async (input, init) => {
    seen = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) }
    return Response.json({ sessionID: "s1", markedUnreadAt: 900, reviewedFiles: [], timeUpdated: 900 })
  }
  const client = createClient({ baseUrl: "http://server" })

  const state = await client.sessionState.update("s1", { markedUnread: true, expectedRevision: 800 })

  assert.equal(seen?.url, "http://server/experimental/opencodex/session-state/s1")
  assert.equal(seen?.method, "PATCH")
  assert.deepEqual(seen?.body, { markedUnread: true, expectedRevision: 800 })
  assert.equal(state?.markedUnreadAt, 900)
  assert.equal(state?.timeUpdated, 900)
})

// A daemon without this route, or a session it has never written state for,
// both answer 404. Neither is an error the user should be shown -- the caller
// needs to be able to tell "unsupported" from "broken".
test("a 404 update answers null instead of throwing", async () => {
  globalThis.fetch = async () => new Response("missing", { status: 404 })
  const client = createClient({ baseUrl: "http://server" })

  assert.equal(await client.sessionState.update("s1", { markedUnread: true }), null)
})

test("a non-404 update failure still throws", async () => {
  globalThis.fetch = async () => new Response("boom", { status: 500 })
  const client = createClient({ baseUrl: "http://server" })

  await assert.rejects(() => client.sessionState.update("s1", { markedUnread: true }))
})

test("hydration reads the card-state route for one directory", async () => {
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return Response.json({
      sessionUiState: { s1: { sessionID: "s1", markedUnreadAt: 600, revision: 600, reviewedFiles: [], displayStatus: "idle", updated: true } },
    })
  }
  const client = createClient({ baseUrl: "http://server" })

  const page = await client.sessionState.hydrate("/Users/me/work")

  assert.deepEqual(urls, ["http://server/experimental/opencodex/state/session-card?directory=%2FUsers%2Fme%2Fwork"])
  assert.equal(page?.sessionUiState.s1.revision, 600)
})

test("hydration passes a cursor through when paging", async () => {
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return Response.json({ sessionUiState: {} })
  }
  const client = createClient({ baseUrl: "http://server" })

  await client.sessionState.hydrate("/w", "abc")

  assert.ok(urls[0].includes("cursor=abc"))
})

test("a 404 hydration answers null so the caller can withdraw the feature", async () => {
  globalThis.fetch = async () => new Response("missing", { status: 404 })
  const client = createClient({ baseUrl: "http://server" })

  assert.equal(await client.sessionState.hydrate("/w"), null)
})
