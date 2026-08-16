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
  setHideSubagents,
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

test("clearing resets everything", () => {
  let filter = setHideSubagents(NO_FILTER, true)
  filter = toggleStatus(filter, "busy")
  assert.equal(isFilterActive(clearFilter()), false)
})

// --- persistence ---

test("a filter round-trips", () => {
  const filter = { hideSubagents: true, statuses: ["busy" as const] }
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
