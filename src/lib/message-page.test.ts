import { test } from "node:test"
import assert from "node:assert/strict"
import {
  NEXT_CURSOR_HEADER,
  REFRESH_WINDOW_CAP,
  REFRESH_PAGE_CAP,
  TRANSCRIPT_PART_BUDGET,
  TRANSCRIPT_RENDER_BUDGET,
  isPendingMessage,
  mergeRefreshMessages,
  mergeOlderPage,
  mergeOlderParts,
  nextCursorFrom,
  oldestLoadedMessageID,
  refreshWindowSize,
  shouldFetchRefreshPage,
  transcriptPageParams,
  transcriptPageQuery,
} from "./message-page.ts"
import type { Message, Part } from "./sdk.ts"

function msg(id: string, role: "user" | "assistant" = "user"): Message {
  return { id, sessionID: "s1", role, time: { created: 1 } }
}

function headers(map: Record<string, string>) {
  return {
    get(name: string) {
      return map[name] ?? map[name.toLowerCase()] ?? null
    },
  }
}

// --- cursor ---

test("the cursor is read from the response header", () => {
  assert.equal(nextCursorFrom(headers({ [NEXT_CURSOR_HEADER]: "abc" })), "abc")
})

test("a missing cursor means no more history", () => {
  assert.equal(nextCursorFrom(headers({})), undefined)
})

// Proxies and RN's own Headers disagree about case.
test("the cursor header is matched case-insensitively", () => {
  assert.equal(nextCursorFrom(headers({ "X-Next-Cursor": "abc" })), "abc")
})

test("a blank cursor is treated as absent, not as a valid cursor", () => {
  assert.equal(nextCursorFrom(headers({ [NEXT_CURSOR_HEADER]: "   " })), undefined)
})

test("an RFC Link next cursor is read when the dedicated header is absent", () => {
  assert.equal(nextCursorFrom(headers({ Link: '</session/s/message?before=opaque%2Fcursor>; rel="next"' })), "opaque/cursor")
})

test("the dedicated opaque cursor wins over a Link cursor", () => {
  assert.equal(nextCursorFrom(headers({ "x-next-cursor": "opaque==", Link: '</?before=wrong>; rel=next' })), "opaque==")
})

test("transcript pages always carry render and part budgets", () => {
  assert.deepEqual(transcriptPageParams(50, "cursor"), {
    limit: 50,
    before: "cursor",
    renderBudget: TRANSCRIPT_RENDER_BUDGET,
    partBudget: TRANSCRIPT_PART_BUDGET,
  })
})

test("page query serializes cursor and both budget parameters", () => {
  assert.equal(
    transcriptPageQuery(transcriptPageParams(50, "opaque+/=")),
    "limit=50&before=opaque%2B%2F%3D&renderBudget=40000&partBudget=4000",
  )
})

// --- merging older pages ---

test("an older page goes in front of what is already loaded", () => {
  const merged = mergeOlderPage({ existing: [msg("c"), msg("d")], older: [msg("a"), msg("b")] })
  assert.deepEqual(merged.map((m) => m.id), ["a", "b", "c", "d"])
})

// The page boundary can overlap a message that arrived over SSE mid-fetch.
test("a message present in both is not duplicated", () => {
  const merged = mergeOlderPage({ existing: [msg("b"), msg("c")], older: [msg("a"), msg("b")] })
  assert.deepEqual(merged.map((m) => m.id), ["a", "b", "c"])
})

test("the existing copy of a duplicate wins, since SSE keeps it current", () => {
  const live = { ...msg("b", "assistant"), time: { created: 1, completed: 99 } }
  const stale = { ...msg("b", "assistant"), time: { created: 1 } }
  const merged = mergeOlderPage({ existing: [live], older: [stale] })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].time.completed, 99)
})

// The data-loss case: a refresh racing a send must not drop what the user typed.
test("pending messages survive a merge and stay last", () => {
  const merged = mergeOlderPage({
    existing: [msg("c"), msg("temp-1")],
    older: [msg("a")],
  })
  assert.deepEqual(merged.map((m) => m.id), ["a", "c", "temp-1"])
})

test("pending messages stay last even when the page is empty", () => {
  const merged = mergeOlderPage({ existing: [msg("temp-1"), msg("c")], older: [] })
  assert.deepEqual(merged.map((m) => m.id), ["c", "temp-1"])
})

test("merging tolerates missing inputs", () => {
  assert.deepEqual(mergeOlderPage({ existing: [], older: [] }), [])
})

test("only temp- ids count as pending", () => {
  assert.equal(isPendingMessage(msg("temp-1")), true)
  assert.equal(isPendingMessage(msg("msg_temp-1")), false)
  assert.equal(isPendingMessage(msg("abc")), false)
})

// --- parts ---

test("older parts fill in without overwriting live ones", () => {
  const existing: Record<string, Part[]> = { a: [{ id: "p1", messageID: "a", type: "text", text: "live" }] }
  const older: Record<string, Part[]> = {
    a: [{ id: "p1", messageID: "a", type: "text", text: "stale" }],
    b: [{ id: "p2", messageID: "b", type: "text", text: "old" }],
  }
  const merged = mergeOlderParts(existing, older)
  assert.equal(merged.a[0].text, "live")
  assert.equal(merged.b[0].text, "old")
})

// --- refresh window ---

test("a refresh never shrinks the window the user paged into", () => {
  assert.equal(refreshWindowSize(300, 50), 300)
})

test("a refresh asks for at least one page", () => {
  assert.equal(refreshWindowSize(0, 50), 50)
  assert.equal(refreshWindowSize(10, 50), 50)
})

// The whole point: a refresh must never become the unbounded fetch again.
test("the refresh window is capped", () => {
  assert.equal(refreshWindowSize(10_000, 50), REFRESH_WINDOW_CAP)
})

test("a nonsense page size still yields a positive window", () => {
  assert.ok(refreshWindowSize(0, 0) >= 1)
  assert.ok(refreshWindowSize(-5, -5) >= 1)
})

test("refresh asks for older pages until it covers the loaded oldest message", () => {
  assert.equal(shouldFetchRefreshPage({ fetched: [msg("c")], oldestLoadedID: "a", nextCursor: "b", pages: 1 }), true)
  assert.equal(shouldFetchRefreshPage({ fetched: [msg("a"), msg("c")], oldestLoadedID: "a", nextCursor: "b", pages: 2 }), false)
})

test("refresh stops at cursor exhaustion and its defensive cap", () => {
  assert.equal(shouldFetchRefreshPage({ fetched: [], oldestLoadedID: "a", pages: 1 }), false)
  assert.equal(shouldFetchRefreshPage({ fetched: [], oldestLoadedID: "a", nextCursor: "b", pages: REFRESH_PAGE_CAP }), false)
})

test("refresh merges server pages without losing optimistic or older messages", () => {
  const live = { ...msg("b"), time: { created: 1, completed: 2 } }
  const merged = mergeRefreshMessages({ existing: [msg("a"), live, msg("temp-1")], fetched: [msg("a"), msg("b"), msg("c")] })
  assert.deepEqual(merged.map((message) => message.id), ["a", "b", "c", "temp-1"])
  assert.equal(merged[1].time.completed, undefined)
})

test("the oldest loaded message ignores optimistic sends", () => {
  assert.equal(oldestLoadedMessageID([msg("temp-1"), msg("a")]), "a")
})
