import { test } from "node:test"
import assert from "node:assert/strict"
import { loadSessionList, normalizeSessions, legacySessionQuery, type SessionListTransport } from "./session-list.ts"
import type { Session } from "./sdk.ts"

// Minimal Session factory — only the fields the list logic reads.
function session(over: Partial<Session> & { id: string }): Session {
  return {
    id: over.id,
    slug: over.slug ?? over.id,
    projectID: "p",
    directory: over.directory ?? "/dir",
    title: over.title ?? over.id,
    version: "1",
    time: over.time ?? { created: 0, updated: 0 },
    ...over,
  } as Session
}

// A fake transport that records which endpoint got hit. getExperimental
// resolves to Session[] (200), null (404 → legacy fallback), or throws (other
// non-2xx), mirroring the real sdk.ts transport contract.
function transport(opts: {
  experimental?: Session[] | null
  experimentalThrows?: Error
  legacy?: Session[]
}): SessionListTransport & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    getExperimental: async () => {
      calls.push("experimental")
      if (opts.experimentalThrows) throw opts.experimentalThrows
      return opts.experimental === undefined ? [] : opts.experimental
    },
    getLegacy: async (query: string) => {
      calls.push(`legacy${query}`)
      return opts.legacy ?? []
    },
  }
}

test("loadSessionList: (a) calls /experimental/session first (global)", async () => {
  const t = transport({ experimental: [session({ id: "a" })] })
  await loadSessionList(t, { roots: true, limit: 50 })
  assert.equal(t.calls[0], "experimental")
  assert.ok(!t.calls.some((c) => c.startsWith("legacy")), "must not hit legacy /session when experimental works")
})

test("loadSessionList: (b) filters to roots (no parentID) when roots:true", async () => {
  const t = transport({
    experimental: [
      session({ id: "root1" }),
      session({ id: "child1", parentID: "root1" }),
      session({ id: "root2" }),
      session({ id: "child2", parentID: "root2" }),
    ],
  })
  const out = await loadSessionList(t, { roots: true })
  assert.deepEqual(
    out.map((s) => s.id).sort(),
    ["root1", "root2"],
    "children (with parentID) must be excluded",
  )
})

test("loadSessionList: roots not set keeps children too", async () => {
  const t = transport({ experimental: [session({ id: "root1" }), session({ id: "child1", parentID: "root1" })] })
  const out = await loadSessionList(t, {})
  assert.equal(out.length, 2)
})

test("loadSessionList: (c) falls back to /session on 404 (older server)", async () => {
  const legacy = [session({ id: "legacy-a" })]
  const t = transport({ experimental: null, legacy })
  const out = await loadSessionList(t, { roots: true, limit: 50 })
  assert.equal(t.calls[0], "experimental")
  assert.equal(t.calls[1], "legacy?roots=true&limit=50", "must call legacy with preserved query params")
  assert.deepEqual(out, legacy, "returns the legacy payload unchanged")
})

test("loadSessionList: (d) sorts by time.updated descending (most recent first)", async () => {
  const t = transport({
    experimental: [
      session({ id: "old", time: { created: 0, updated: 100 } }),
      session({ id: "newest", time: { created: 0, updated: 300 } }),
      session({ id: "mid", time: { created: 0, updated: 200 } }),
    ],
  })
  const out = await loadSessionList(t, { roots: true })
  assert.deepEqual(out.map((s) => s.id), ["newest", "mid", "old"])
})

test("loadSessionList: applies limit AFTER root-filter + sort", async () => {
  const t = transport({
    experimental: [
      session({ id: "c1", parentID: "r", time: { created: 0, updated: 999 } }),
      session({ id: "r1", time: { created: 0, updated: 100 } }),
      session({ id: "r2", time: { created: 0, updated: 200 } }),
      session({ id: "r3", time: { created: 0, updated: 300 } }),
    ],
  })
  const out = await loadSessionList(t, { roots: true, limit: 2 })
  // Children excluded first, then sort desc, then take 2 → r3, r2 (not the child).
  assert.deepEqual(out.map((s) => s.id), ["r3", "r2"])
})

test("loadSessionList: search matches title case-insensitively", async () => {
  const t = transport({
    experimental: [session({ id: "1", title: "Fix Auth Bug" }), session({ id: "2", title: "Add feature" })],
  })
  const out = await loadSessionList(t, { search: "AUTH" })
  assert.deepEqual(out.map((s) => s.id), ["1"])
})

test("loadSessionList: non-404 experimental error propagates (no silent fallback)", async () => {
  const t = transport({ experimentalThrows: new Error("API Error: 500 - boom") })
  await assert.rejects(() => loadSessionList(t, {}), /500/)
  assert.ok(!t.calls.some((c) => c.startsWith("legacy")), "500 must NOT fall back to legacy")
})

test("normalizeSessions: tolerates non-array input", () => {
  assert.deepEqual(normalizeSessions(undefined as unknown as Session[]), [])
})

test("legacySessionQuery: builds the same query the old code sent", () => {
  assert.equal(legacySessionQuery({ roots: true, limit: 50 }), "?roots=true&limit=50")
  assert.equal(legacySessionQuery({}), "")
  assert.equal(legacySessionQuery({ search: "x" }), "?search=x")
})

// --- includeChildren (Swarm root grouping mode) ---

const s = (id: string, updated: number, parentID?: string) =>
  ({ id, parentID, title: id, time: { created: 1, updated } }) as never

test("includeChildren keeps children of the roots being shown", () => {
  const all = [s("root1", 30), s("child1a", 20, "root1"), s("root2", 10)]
  const out = normalizeSessions(all, { roots: true, includeChildren: true })
  assert.deepEqual(
    out.map((x: { id: string }) => x.id).sort(),
    ["child1a", "root1", "root2"],
  )
})

// The trap the roots filter exists to avoid: children must not eat the limit.
test("limit still counts roots only, children ride along free", () => {
  const all = [
    s("root1", 50),
    s("c1", 49, "root1"),
    s("c2", 48, "root1"),
    s("root2", 40),
    s("c3", 39, "root2"),
    s("root3", 30),
  ]
  const out = normalizeSessions(all, { roots: true, includeChildren: true, limit: 2 })
  const ids = out.map((x: { id: string }) => x.id)
  assert.deepEqual(ids.filter((id) => id.startsWith("root")), ["root1", "root2"])
  assert.deepEqual(ids.filter((id) => id.startsWith("c")).sort(), ["c1", "c2", "c3"])
})

test("children of a root beyond the limit are not included", () => {
  const all = [s("root1", 50), s("root2", 40), s("c2", 39, "root2")]
  const out = normalizeSessions(all, { roots: true, includeChildren: true, limit: 1 })
  assert.deepEqual(out.map((x: { id: string }) => x.id), ["root1"])
})

test("an orphaned child (parent absent) is not resurrected", () => {
  const all = [s("root1", 50), s("orphan", 40, "missing-parent")]
  const out = normalizeSessions(all, { roots: true, includeChildren: true })
  assert.deepEqual(out.map((x: { id: string }) => x.id), ["root1"])
})

test("without includeChildren the previous root-only behaviour is unchanged", () => {
  const all = [s("root1", 30), s("child1a", 20, "root1")]
  assert.deepEqual(normalizeSessions(all, { roots: true }).map((x: { id: string }) => x.id), ["root1"])
})

test("search still applies before roots are chosen", () => {
  const all = [s("alpha", 30), s("beta", 20), s("alpha-child", 10, "alpha")]
  const out = normalizeSessions(all, { roots: true, includeChildren: true, search: "alpha" })
  assert.deepEqual(out.map((x: { id: string }) => x.id).sort(), ["alpha", "alpha-child"])
})
