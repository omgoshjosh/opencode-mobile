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

export interface SessionFilter {
  /** Hide anything below a root — a swarm's roles and their subagents. */
  hideSubagents: boolean
  /** Attention states to show. Empty means "no status filter", not "none". */
  statuses: Attention[]
}

export const NO_FILTER: SessionFilter = { hideSubagents: false, statuses: [] }

/** Order the chips are offered in — most actionable first. */
export const FILTERABLE_STATUSES: Attention[] = ["needs-attention", "busy", "retry", "complete", "idle"]

export function isFilterActive(filter: SessionFilter): boolean {
  return filter.hideSubagents || filter.statuses.length > 0
}

/**
 * How many filters are on, for a badge.
 *
 * Status chips count as one filter collectively, not one each: they are a
 * single "which states" decision, and counting five chips as five active
 * filters overstates how narrowed the list is.
 */
export function activeFilterCount(filter: SessionFilter): number {
  return (filter.hideSubagents ? 1 : 0) + (filter.statuses.length > 0 ? 1 : 0)
}

/**
 * Does one session survive the filter?
 *
 * `depth` is 0 for a root; anything greater is a subagent or a swarm role.
 * An empty `statuses` passes everything — the alternative (empty means show
 * nothing) makes the first tap that clears the last chip blank the screen.
 */
export function matchesFilter(
  session: { depth: number; attention: Attention },
  filter: SessionFilter,
): boolean {
  if (filter.hideSubagents && session.depth > 0) return false
  if (filter.statuses.length > 0 && !filter.statuses.includes(session.attention)) return false
  return true
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
  if (filter.statuses.length > 0) parts.push(filter.statuses.map(attentionLabel).join(", "))
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
    return { hideSubagents: parsed.hideSubagents === true, statuses }
  } catch {
    return NO_FILTER
  }
}
