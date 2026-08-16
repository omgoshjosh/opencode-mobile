// Narrowing the session list.
//
// Grouping answers "how is this organised"; it does not answer "show me only
// the things that want something from me". With 50 roots and 146 descendants,
// the two questions that actually get asked are:
//
//   - "hide the subagents" — a swarm's task graph is most of the list by
//     volume, and when you are looking for a conversation you started, the
//     roles it spawned are noise.
//   - "only what needs me" — the reason to open the app at all.
//
// Filtering is deliberately separate from grouping rather than another group
// mode: they compose. "Group by swarm root, showing only what needs you" is a
// useful view, and it is impossible if narrowing is spelled as a grouping.
//
// Pure, so the predicates are testable without a store.

import { attentionLabel } from "./session-attention.ts"
import type { Attention } from "./session-attention"

/**
 * Recency windows.
 *
 * Rolling durations rather than calendar buckets: mixing "past hour" (rolling)
 * with "today" (calendar) means the same session changes bucket at midnight
 * without anything happening to it, which is confusing in a list you check at
 * odd hours. The date GROUPING mode is calendar-based on purpose — that is a
 * "when did I do this" question. This is a "what is still warm" question.
 */
export type Recency = "any" | "hour" | "day" | "week"

export const RECENCY_WINDOWS: { value: Recency; label: string; ms: number }[] = [
  { value: "hour", label: "past hour", ms: 60 * 60 * 1000 },
  { value: "day", label: "past day", ms: 24 * 60 * 60 * 1000 },
  { value: "week", label: "past week", ms: 7 * 24 * 60 * 60 * 1000 },
]

export function recencyWindowMs(recency: Recency): number | null {
  return RECENCY_WINDOWS.find((w) => w.value === recency)?.ms ?? null
}

export interface SessionFilter {
  /** Hide anything below a root — a swarm's roles and their subagents. */
  hideSubagents: boolean
  /** Attention states to show. Empty means "no status filter", not "none". */
  statuses: Attention[]
  /** Only sessions updated within this rolling window. */
  recency: Recency
  /** Fuzzy title query. Empty means no name filter. */
  query: string
}

export const NO_FILTER: SessionFilter = { hideSubagents: false, statuses: [], recency: "any", query: "" }

/** Order the chips are offered in — most actionable first. */
export const FILTERABLE_STATUSES: Attention[] = ["needs-attention", "busy", "retry", "complete", "idle"]

export function isFilterActive(filter: SessionFilter): boolean {
  return (
    filter.hideSubagents ||
    filter.statuses.length > 0 ||
    filter.recency !== "any" ||
    filter.query.trim().length > 0
  )
}

/**
 * Fuzzy subsequence match, the fzf rule: every character of the query appears
 * in the target in order, not necessarily adjacent. "rel" matches "Release
 * Engineer"; "reng" matches it too.
 *
 * Chosen over substring matching because session titles are long and
 * generated -- "Release Engineer scope issue nine (@general subagent)" -- so
 * remembering an exact contiguous fragment is the hard part. Chosen over a
 * real edit-distance ranker because this is a filter, not a search box: the
 * list keeps its grouping and order, and a scored reordering would fight the
 * grouping the user picked.
 */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const target = (text ?? "").toLowerCase()

  let index = 0
  for (const char of q) {
    // Spaces in the query are treated as "anything may follow", so typing
    // multiple words does not require them to be adjacent in the title.
    if (char === " ") continue
    const found = target.indexOf(char, index)
    if (found === -1) return false
    index = found + 1
  }
  return true
}

/**
 * How many filters are on, for a badge.
 *
 * Status chips count as one filter collectively, not one each: they are a
 * single "which states" decision, and counting five chips as five active
 * filters overstates how narrowed the list is.
 */
export function activeFilterCount(filter: SessionFilter): number {
  return (
    (filter.hideSubagents ? 1 : 0) +
    (filter.statuses.length > 0 ? 1 : 0) +
    (filter.recency !== "any" ? 1 : 0) +
    (filter.query.trim() ? 1 : 0)
  )
}

/**
 * Does one session survive the filter?
 *
 * `depth` is 0 for a root; anything greater is a subagent or a swarm role.
 * An empty `statuses` passes everything — the alternative (empty means show
 * nothing) makes the first tap that clears the last chip blank the screen.
 */
export function matchesFilter(
  session: { depth: number; attention: Attention; title?: string; updatedAt?: number },
  filter: SessionFilter,
  nowMs: number = Date.now(),
): boolean {
  if (filter.hideSubagents && session.depth > 0) return false
  if (filter.statuses.length > 0 && !filter.statuses.includes(session.attention)) return false

  const window = recencyWindowMs(filter.recency)
  if (window !== null) {
    // A session with no timestamp cannot be shown to be recent, so it fails a
    // recency filter rather than passing by default — otherwise "past hour"
    // silently includes things of unknown age.
    if (!session.updatedAt) return false
    if (nowMs - session.updatedAt > window) return false
  }

  if (filter.query.trim() && !fuzzyMatch(filter.query, session.title ?? "")) return false
  return true
}

export function setRecency(filter: SessionFilter, recency: Recency): SessionFilter {
  return { ...filter, recency }
}

export function setQuery(filter: SessionFilter, query: string): SessionFilter {
  return { ...filter, query }
}

/** Toggle one status chip. */
export function toggleStatus(filter: SessionFilter, status: Attention): SessionFilter {
  const has = filter.statuses.includes(status)
  return {
    ...filter,
    statuses: has ? filter.statuses.filter((s) => s !== status) : [...filter.statuses, status],
  }
}

export function setHideSubagents(filter: SessionFilter, hide: boolean): SessionFilter {
  return { ...filter, hideSubagents: hide }
}

export function clearFilter(): SessionFilter {
  return { ...NO_FILTER, statuses: [] }
}

/**
 * Human summary for the filter bar, so the current narrowing is legible
 * without opening the sheet. A filtered list that doesn't say it is filtered
 * reads as missing data.
 */
export function filterSummary(filter: SessionFilter): string {
  const parts: string[] = []
  // The human label, not the raw key: the bar was showing "needs-attention"
  // where the badge on every row says "needs you".
  // The query leads: when searching, that is what you are looking at.
  if (filter.query.trim()) parts.push(`"${filter.query.trim()}"`)
  if (filter.statuses.length > 0) parts.push(filter.statuses.map(attentionLabel).join(", "))
  const window = RECENCY_WINDOWS.find((w) => w.value === filter.recency)
  if (window) parts.push(window.label)
  if (filter.hideSubagents) parts.push("roots only")
  return parts.length > 0 ? parts.join(" · ") : "All sessions"
}

/**
 * Parse the persisted filter.
 *
 * Unknown status strings are dropped rather than kept: a renamed or removed
 * attention state would otherwise persist forever as a filter that matches
 * nothing, leaving an empty list with no obvious cause.
 */
export function parseFilter(raw: string | null | undefined): SessionFilter {
  if (!raw) return NO_FILTER
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return NO_FILTER
    const statuses = Array.isArray(parsed.statuses)
      ? parsed.statuses.filter((s: unknown): s is Attention =>
          typeof s === "string" && (FILTERABLE_STATUSES as string[]).includes(s),
        )
      : []
    const recency: Recency = RECENCY_WINDOWS.some((w) => w.value === parsed.recency) ? parsed.recency : "any"
    // The query is deliberately NOT persisted: a search term restored days
    // later looks like an empty session list, and unlike the other filters it
    // is cheap to retype and rarely meant to be durable.
    return { hideSubagents: parsed.hideSubagents === true, statuses, recency, query: "" }
  } catch {
    return NO_FILTER
  }
}
