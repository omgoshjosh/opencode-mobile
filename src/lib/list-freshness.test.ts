import { test } from "node:test"
import assert from "node:assert/strict"
import {
  serializeSnapshot,
  parseSnapshot,
  listFreshness,
  ageLabel,
  SNAPSHOT_MAX_SESSIONS,
} from "./list-freshness.ts"
import type { Session } from "./sdk"

function fakeSession(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    slug: id,
    projectID: "p",
    directory: "/w",
    title: `title-${id}`,
    version: "1",
    time: { created: 1, updated: 2 },
    ...extra,
  }
}

test("round-trip preserves list-rendering fields", () => {
  const sessions = [fakeSession("a", { parentID: "root", model: { providerID: "swarm", id: "swm_1" } })]
  const parsed = parseSnapshot(serializeSnapshot(sessions, 123))
  assert.equal(parsed?.savedAt, 123)
  assert.equal(parsed?.sessions[0].id, "a")
  assert.equal(parsed?.sessions[0].parentID, "root")
  assert.equal(parsed?.sessions[0].model?.id, "swm_1")
})

test("revert and share state never survive persistence — stale versions could target the wrong message", () => {
  const sessions = [
    fakeSession("a", { revert: { messageID: "m1" }, share: { url: "https://x" } }),
  ]
  const parsed = parseSnapshot(serializeSnapshot(sessions, 1))
  assert.equal(parsed?.sessions[0].revert, undefined)
  assert.equal(parsed?.sessions[0].share, undefined)
})

test("snapshot is bounded", () => {
  const many = Array.from({ length: SNAPSHOT_MAX_SESSIONS + 50 }, (_, i) => fakeSession(`s${i}`))
  const parsed = parseSnapshot(serializeSnapshot(many, 1))
  assert.equal(parsed?.sessions.length, SNAPSHOT_MAX_SESSIONS)
})

test("corrupt or legacy snapshots degrade to null, never throw", () => {
  assert.equal(parseSnapshot(null), null)
  assert.equal(parseSnapshot(""), null)
  assert.equal(parseSnapshot("{not json"), null)
  assert.equal(parseSnapshot(JSON.stringify({ sessions: "nope" })), null)
  assert.equal(parseSnapshot(JSON.stringify({ savedAt: "later", sessions: [] })), null)
})

test("malformed entries inside an otherwise-valid snapshot are dropped", () => {
  const raw = JSON.stringify({ savedAt: 1, sessions: [fakeSession("ok"), { id: 42 }, null] })
  assert.deepEqual(parseSnapshot(raw)?.sessions.map((s) => s.id), ["ok"])
})

test("fresh network data needs no banner", () => {
  assert.equal(listFreshness({ hasSessions: true, source: "network", asOf: 100, loadFailed: false }), null)
})

test("snapshot-sourced rows are labelled until a live refresh lands", () => {
  assert.deepEqual(listFreshness({ hasSessions: true, source: "snapshot", asOf: 100, loadFailed: false }), {
    kind: "snapshot",
    asOf: 100,
  })
})

test("a failed refresh outranks the snapshot label — the retry affordance must win", () => {
  assert.deepEqual(listFreshness({ hasSessions: true, source: "snapshot", asOf: 100, loadFailed: true }), {
    kind: "refresh-failed",
    asOf: 100,
  })
  assert.deepEqual(listFreshness({ hasSessions: true, source: "network", asOf: 200, loadFailed: true }), {
    kind: "refresh-failed",
    asOf: 200,
  })
})

test("an empty list has nothing to mislead about", () => {
  assert.equal(listFreshness({ hasSessions: false, source: "snapshot", asOf: 100, loadFailed: true }), null)
  assert.equal(listFreshness({ hasSessions: true, source: null, asOf: null, loadFailed: true }), null)
})

test("age labels are coarse and monotone", () => {
  const base = 10_000_000
  assert.equal(ageLabel(base, base + 30_000), "just now")
  assert.equal(ageLabel(base, base + 5 * 60_000), "5m ago")
  assert.equal(ageLabel(base, base + 3 * 3_600_000), "3h ago")
  assert.equal(ageLabel(base, base + 49 * 3_600_000), "2d ago")
  // Clock skew (asOf in the future) must not print negative time.
  assert.equal(ageLabel(base + 60_000, base), "just now")
})
