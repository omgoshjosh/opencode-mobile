// Grouping modes for the sessions list.
//
// The list was hardcoded to group by project directory. That is one useful
// lens, but not the only one — "which team is this?", "what's running right
// now?" and "what did I touch today?" are all questions the same list can
// answer if the grouping key is swappable.
//
// Deliberately ONE level of nesting plus a single-select picker, rather than
// nested groups. Two independent collapse dimensions on a phone screen is hard
// to read and doubles the state to persist, for little gain.
//
// The important consequence: grouping by *swarm root session* IS the nested
// swarm view — each root's whole task graph appears under it — without
// recursive rendering or a second collapse dimension. Nesting becomes a
// grouping mode.
//
// "One level of nesting" refers to the RENDERED depth, not the data: a swarm's
// descendants are a tree of arbitrary depth, and every one of them groups under
// the same root header. Reading it as a data constraint is what produced the
// depth-1 bug this module used to have.
//
// Dependency-free apart from the sibling tree helper, so it stays testable
// under plain `node --test`.
import { rootIDOf } from "./session-tree.ts"

// Mirrors SWARM_PROVIDER_ID in ./swarm-model. Duplicated deliberately: the
// pure helpers in this directory avoid runtime imports so they stay testable
// under plain `node --test` (see the other *.test.ts here, which import the
// module directly). A drift guard lives in this module's test.
const SWARM_PROVIDER_ID = "swarm"

export type GroupMode = "directory" | "swarm" | "root" | "date" | "status"

export const GROUP_MODES: GroupMode[] = ["directory", "swarm", "root", "date", "status"]

export const DEFAULT_GROUP_MODE: GroupMode = "directory"

/** Sessions with no value for the current key land here, always sorted last. */
export const UNGROUPED_KEY = "￿:ungrouped"

export interface GroupableSession {
  id: string
  directory?: string
  parentID?: string
  title?: string
  model?: { providerID?: string; id?: string } | null
  time?: { updated?: number } | null
}

export function isGroupMode(value: unknown): value is GroupMode {
  return typeof value === "string" && (GROUP_MODES as string[]).includes(value)
}

/** Day buckets, coarse enough to stay useful without a date picker. */
export function dateBucket(updatedMs: number | undefined, nowMs: number): string {
  if (!updatedMs) return UNGROUPED_KEY
  const day = 24 * 60 * 60 * 1000
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const start = startOfToday.getTime()
  if (updatedMs >= start) return "Today"
  if (updatedMs >= start - day) return "Yesterday"
  if (updatedMs >= start - 7 * day) return "This week"
  if (updatedMs >= start - 30 * day) return "This month"
  return "Older"
}

/**
 * The group key for a session under a given mode.
 *
 * `status` is passed in rather than read from a store so this stays pure — the
 * caller already holds the SSE-driven status map.
 */
export function groupKey(
  session: GroupableSession,
  mode: GroupMode,
  context: {
    nowMs: number
    statusOf?: (id: string) => string | undefined
    /**
     * All loaded sessions, indexed. Required for "root" mode to resolve a
     * session's topmost ancestor; omitting it falls back to the old
     * single-level behaviour rather than throwing.
     */
    sessionsByID?: Map<string, { id: string; parentID?: string }>
  },
): string {
  switch (mode) {
    case "directory":
      return session.directory || UNGROUPED_KEY
    case "swarm":
      return session.model?.providerID === SWARM_PROVIDER_ID && session.model.id
        ? session.model.id
        : UNGROUPED_KEY
    case "root":
      // Everything in a tree groups under its topmost ancestor, so a swarm and
      // its whole task graph land in one bucket. This used to return
      // `parentID || id`, which is only correct at depth 1: a grandchild
      // grouped under its parent role and appeared as a separate top-level
      // group beside the swarm that spawned it. See src/lib/session-tree.ts.
      return context.sessionsByID ? rootIDOf(session, context.sessionsByID) : session.parentID || session.id
    case "date":
      return dateBucket(session.time?.updated, context.nowMs)
    case "status":
      return context.statusOf?.(session.id) || "idle"
    default:
      return UNGROUPED_KEY
  }
}

// Busy first — the same precedence the status badges use, so the two agree.
const STATUS_ORDER = ["busy", "retry", "idle"]

/**
 * Sort order for group keys within a mode. Returns a comparable number;
 * callers use it to order the flattened rows.
 */
export function groupSortIndex(key: string, mode: GroupMode): number {
  if (key === UNGROUPED_KEY) return Number.MAX_SAFE_INTEGER
  if (mode === "status") {
    const i = STATUS_ORDER.indexOf(key)
    return i === -1 ? STATUS_ORDER.length : i
  }
  if (mode === "date") {
    const order = ["Today", "Yesterday", "This week", "This month", "Older"]
    const i = order.indexOf(key)
    return i === -1 ? order.length : i
  }
  return 0 // directory/swarm/root keep first-seen order
}
