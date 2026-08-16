import { test } from "node:test"
import assert from "node:assert/strict"
import {
  FILTERABLE_STATUSES,
  NO_FILTER,
  activeFilterCount,
  clearFilter,
  filterSummary,
  isFilterActive,
  matchesFilter,
  parseFilter,
  bestMatchSpan,
  fuzzyMatch,
  matchSpanLimit,
  setHideSubagents,
  setQuery,
  setRecency,
  toggleStatus,
} from "./session-filters.ts"

// --- default ---

test("the default filter shows everything", () => {
  assert.equal(isFilterActive(NO_FILTER), false)
  assert.equal(matchesFilter({ depth: 0, attention: "idle" }, NO_FILTER), true)
  assert.equal(matchesFilter({ depth: 3, attention: "busy" }, NO_FILTER), true)
})

// --- subagents ---

test("hiding subagents keeps roots and drops everything below", () => {
  const filter = setHideSubagents(NO_FILTER, true)
  assert.equal(matchesFilter({ depth: 0, attention: "idle" }, filter), true)
  assert.equal(matchesFilter({ depth: 1, attention: "idle" }, filter), false)
  assert.equal(matchesFilter({ depth: 2, attention: "idle" }, filter), false)
})

// --- statuses ---

test("an empty status list is not a filter", () => {
  for (const status of FILTERABLE_STATUSES) {
    assert.equal(matchesFilter({ depth: 0, attention: status }, NO_FILTER), true)
  }
})

test("a status filter keeps only the chosen states", () => {
  const filter = toggleStatus(NO_FILTER, "needs-attention")
  assert.equal(matchesFilter({ depth: 0, attention: "needs-attention" }, filter), true)
  assert.equal(matchesFilter({ depth: 0, attention: "idle" }, filter), false)
})

test("statuses accumulate", () => {
  let filter = toggleStatus(NO_FILTER, "needs-attention")
  filter = toggleStatus(filter, "busy")
  assert.equal(matchesFilter({ depth: 0, attention: "busy" }, filter), true)
  assert.equal(matchesFilter({ depth: 0, attention: "needs-attention" }, filter), true)
  assert.equal(matchesFilter({ depth: 0, attention: "done" as never }, filter), false)
})

test("toggling a status off removes it", () => {
  let filter = toggleStatus(NO_FILTER, "busy")
  filter = toggleStatus(filter, "busy")
  assert.deepEqual(filter.statuses, [])
})

// Clearing the last chip must not blank the screen.
test("clearing the last status reverts to showing everything", () => {
  let filter = toggleStatus(NO_FILTER, "busy")
  filter = toggleStatus(filter, "busy")
  assert.equal(matchesFilter({ depth: 0, attention: "idle" }, filter), true)
})

// --- combined ---

test("filters compose: roots only AND needs-attention", () => {
  let filter = setHideSubagents(NO_FILTER, true)
  filter = toggleStatus(filter, "needs-attention")
  assert.equal(matchesFilter({ depth: 0, attention: "needs-attention" }, filter), true)
  assert.equal(matchesFilter({ depth: 1, attention: "needs-attention" }, filter), false)
  assert.equal(matchesFilter({ depth: 0, attention: "idle" }, filter), false)
})

// --- counting ---

test("status chips count as one filter collectively, not one each", () => {
  let filter = toggleStatus(NO_FILTER, "busy")
  filter = toggleStatus(filter, "idle")
  filter = toggleStatus(filter, "complete")
  assert.equal(activeFilterCount(filter), 1)
})

test("subagent and status filters count separately", () => {
  let filter = setHideSubagents(NO_FILTER, true)
  assert.equal(activeFilterCount(filter), 1)
  filter = toggleStatus(filter, "busy")
  assert.equal(activeFilterCount(filter), 2)
})

test("nothing on counts zero", () => {
  assert.equal(activeFilterCount(NO_FILTER), 0)
})

// --- summary ---

test("the summary names the active narrowing", () => {
  assert.equal(filterSummary(NO_FILTER), "All sessions")
  assert.match(filterSummary(setHideSubagents(NO_FILTER, true)), /roots only/)
  assert.match(filterSummary(toggleStatus(NO_FILTER, "busy")), /busy/)
})

// The bar showed "needs-attention" where every row's badge says "needs you".
test("the summary uses the same labels the badges use, not raw keys", () => {
  const summary = filterSummary(toggleStatus(NO_FILTER, "needs-attention"))
  assert.equal(summary.includes("needs-attention"), false)
  assert.match(summary, /needs you/)
})

test("clearing resets everything", () => {
  let filter = setHideSubagents(NO_FILTER, true)
  filter = toggleStatus(filter, "busy")
  assert.equal(isFilterActive(clearFilter()), false)
})

// --- persistence ---

test("a filter round-trips", () => {
  const filter = { hideSubagents: true, statuses: ["busy" as const], recency: "day" as const, query: "" }
  assert.deepEqual(parseFilter(JSON.stringify(filter)), filter)
})

// A removed or renamed state would otherwise persist as a filter matching
// nothing, leaving an empty list with no visible cause.
test("unknown persisted statuses are dropped", () => {
  const got = parseFilter(JSON.stringify({ hideSubagents: false, statuses: ["busy", "obsolete-state"] }))
  assert.deepEqual(got.statuses, ["busy"])
})

test("corrupt persisted values degrade to no filter", () => {
  assert.deepEqual(parseFilter("not json"), NO_FILTER)
  assert.deepEqual(parseFilter("null"), NO_FILTER)
  assert.deepEqual(parseFilter(""), NO_FILTER)
  assert.deepEqual(parseFilter(null), NO_FILTER)
  assert.deepEqual(parseFilter(JSON.stringify({ statuses: "busy" })), NO_FILTER)
})

test("a truthy-but-not-true hideSubagents is not honoured", () => {
  assert.equal(parseFilter(JSON.stringify({ hideSubagents: "yes", statuses: [] })).hideSubagents, false)
})

// --- fuzzy name matching ---

test("an empty query matches everything", () => {
  assert.equal(fuzzyMatch("", "anything"), true)
  assert.equal(fuzzyMatch("   ", "anything"), true)
})

// Session titles are long and generated, so remembering a contiguous
// fragment is the hard part -- subsequence matching is what makes them
// reachable.
test("characters may be non-adjacent, in order", () => {
  const title = "Release Engineer scope issue nine (@general subagent)"
  assert.equal(fuzzyMatch("rel", title), true)
  assert.equal(fuzzyMatch("reng", title), true)
  // "rsin" is a subsequence too, but spread across the whole title — the
  // compactness bound rejects it, which is the point.
  assert.equal(fuzzyMatch("rsin", title), false)
})

test("out-of-order characters do not match", () => {
  assert.equal(fuzzyMatch("engrel", "Release Engineer"), false)
})

test("matching is case-insensitive both ways", () => {
  assert.equal(fuzzyMatch("RELEASE", "release engineer"), true)
  assert.equal(fuzzyMatch("release", "RELEASE ENGINEER"), true)
})

test("spaces in the query do not require adjacency", () => {
  assert.equal(fuzzyMatch("rel eng", "Release Engineer"), true)
})

test("a character absent from the target fails", () => {
  assert.equal(fuzzyMatch("relz", "Release Engineer"), false)
})

test("a missing title fails rather than throwing", () => {
  assert.equal(fuzzyMatch("x", ""), false)
  assert.equal(fuzzyMatch("x", undefined as never), false)
})

test("the query filters by title through matchesFilter", () => {
  const filter = setQuery(NO_FILTER, "reng")
  assert.equal(matchesFilter({ depth: 0, attention: "idle", title: "Release Engineer" }, filter), true)
  assert.equal(matchesFilter({ depth: 0, attention: "idle", title: "Security Reviewer" }, filter), false)
})

// --- recency ---

const NOW = 1_000_000_000

test("any recency imposes no window", () => {
  assert.equal(matchesFilter({ depth: 0, attention: "idle", updatedAt: 1 }, NO_FILTER, NOW), true)
})

test("a session inside the window passes", () => {
  const filter = setRecency(NO_FILTER, "hour")
  assert.equal(matchesFilter({ depth: 0, attention: "idle", updatedAt: NOW - 60_000 }, filter, NOW), true)
})

test("a session outside the window fails", () => {
  const filter = setRecency(NO_FILTER, "hour")
  assert.equal(matchesFilter({ depth: 0, attention: "idle", updatedAt: NOW - 2 * 3600_000 }, filter, NOW), false)
})

test("the windows widen as expected", () => {
  const twoDaysAgo = NOW - 2 * 24 * 3600_000
  assert.equal(matchesFilter({ depth: 0, attention: "idle", updatedAt: twoDaysAgo }, setRecency(NO_FILTER, "day"), NOW), false)
  assert.equal(matchesFilter({ depth: 0, attention: "idle", updatedAt: twoDaysAgo }, setRecency(NO_FILTER, "week"), NOW), true)
})

// Otherwise "past hour" silently includes sessions of unknown age.
test("an unknown timestamp fails a recency filter rather than passing", () => {
  const filter = setRecency(NO_FILTER, "hour")
  assert.equal(matchesFilter({ depth: 0, attention: "idle" }, filter, NOW), false)
})

// --- combined + counting ---

test("every filter composes", () => {
  let filter = setHideSubagents(NO_FILTER, true)
  filter = toggleStatus(filter, "idle")
  filter = setRecency(filter, "day")
  filter = setQuery(filter, "rel")
  const ok = { depth: 0, attention: "idle" as const, title: "Release Engineer", updatedAt: NOW - 1000 }
  assert.equal(matchesFilter(ok, filter, NOW), true)
  assert.equal(matchesFilter({ ...ok, depth: 1 }, filter, NOW), false)
  assert.equal(matchesFilter({ ...ok, title: "Something else" }, filter, NOW), false)
  assert.equal(matchesFilter({ ...ok, updatedAt: NOW - 5 * 24 * 3600_000 }, filter, NOW), false)
})

test("each filter dimension counts once", () => {
  let filter = setHideSubagents(NO_FILTER, true)
  filter = toggleStatus(filter, "busy")
  filter = setRecency(filter, "day")
  filter = setQuery(filter, "x")
  assert.equal(activeFilterCount(filter), 4)
})

test("a whitespace-only query is not a filter", () => {
  assert.equal(isFilterActive(setQuery(NO_FILTER, "   ")), false)
  assert.equal(activeFilterCount(setQuery(NO_FILTER, "   ")), 0)
})

test("the summary names recency and the query", () => {
  assert.match(filterSummary(setRecency(NO_FILTER, "hour")), /past hour/)
  assert.match(filterSummary(setQuery(NO_FILTER, "rel")), /"rel"/)
})

// --- persistence of the new fields ---

test("recency round-trips; an unknown window degrades to any", () => {
  assert.equal(parseFilter(JSON.stringify({ recency: "week" })).recency, "week")
  assert.equal(parseFilter(JSON.stringify({ recency: "fortnight" })).recency, "any")
})

// A search term restored days later looks like an empty session list.
test("the query is deliberately not persisted", () => {
  assert.equal(parseFilter(JSON.stringify({ query: "old search" })).query, "")
})

// --- match compactness ---
//
// Measured against real session titles: intent produces a local match,
// accidents sprawl across the string.

const REAL_TITLES = {
  releaseEngineer: "Release Engineer scope issue nine (@general subagent)",
  animalGame: "Realistic animal journey anthology game",
  securityReviewer: "Security Reviewer audit sync (@general subagent)",
  reliability: "Opencodex reliability team",
  yondi: "Yondi Dev",
}

test("a query matches the title it was meant for", () => {
  assert.equal(fuzzyMatch("reng", REAL_TITLES.releaseEngineer), true)
  assert.equal(fuzzyMatch("sec", REAL_TITLES.securityReviewer), true)
  assert.equal(fuzzyMatch("yond", REAL_TITLES.yondi), true)
  assert.equal(fuzzyMatch("rel", REAL_TITLES.reliability), true)
})

// The bug this bound fixes: subsequence alone matched nearly everything.
test("a sprawling accidental subsequence is rejected", () => {
  assert.equal(fuzzyMatch("reng", REAL_TITLES.animalGame), false)
  assert.equal(fuzzyMatch("reng", REAL_TITLES.securityReviewer), false)
  assert.equal(fuzzyMatch("sec", REAL_TITLES.releaseEngineer), false)
  assert.equal(fuzzyMatch("rel", REAL_TITLES.securityReviewer), false)
})

test("the span limit is generous for short queries", () => {
  assert.ok(matchSpanLimit(2) >= 8)
  assert.ok(matchSpanLimit(10) >= 30)
})

// Greedy leftmost matching failed this: it takes the "a" of "Realistic" and
// drags the match across 32 chars, so the compactness check rejected a title
// that literally contains the word.
test("the tightest match is found, not the leftmost", () => {
  assert.equal(bestMatchSpan("anthology", "realistic animal journey anthology game"), 9)
})

test("an exact substring always matches", () => {
  assert.equal(fuzzyMatch("Release Engineer", REAL_TITLES.releaseEngineer), true)
  assert.equal(fuzzyMatch("anthology", REAL_TITLES.animalGame), true)
})
