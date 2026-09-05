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

test("an unavailable live tree response falls back to the plain root list", async () => {
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    urls.push(url)
    if (url.includes("/session/tree?live=true")) return new Response("missing", { status: 404 })
    return Response.json([{ id: "root", title: "root", time: { created: 0, updated: 0 } }])
  }
  const client = createClient({ baseUrl: "http://server" })

  const sessions = (await client.session.tree()) ?? await client.session.list({ roots: true })

  assert.deepEqual(sessions.map((session) => session.id), ["root"])
  assert.deepEqual(urls, ["http://server/session/tree?live=true", "http://server/experimental/session?limit=200&roots=true"])
})

test("an unavailable live children response retries the plain endpoint", async () => {
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    urls.push(url)
    if (url.includes("state=live")) return new Response("missing", { status: 404 })
    return Response.json([{ id: "worker", parentID: "root", title: "worker", time: { created: 0, updated: 0 } }])
  }
  const client = createClient({ baseUrl: "http://server" })

  const children = await client.session.children("root")

  assert.deepEqual(children?.map((session) => session.id), ["worker"])
  assert.deepEqual(urls, ["http://server/session/root/children?state=live", "http://server/session/root/children"])
})

test("non-capability errors remain errors", async () => {
  globalThis.fetch = async () => new Response("broken", { status: 500 })
  const client = createClient({ baseUrl: "http://server" })

  await assert.rejects(client.session.tree(), { name: "ApiError" })
  await assert.rejects(client.session.children("root"), { name: "ApiError" })
})
