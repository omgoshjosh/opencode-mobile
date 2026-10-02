// Who a working session ultimately works for (#53).
//
// The list keeps roots only, and the daemon's live tree carries just a root's
// LIVE direct children, so an idle manager between a root and its busy worker
// is invisible there. Every other source — `session.created`/`updated` events,
// expanded children, and `GET /session/:id` for a working session we cannot
// place — feeds one parent index, and the chip walks it.
//
// Pure and dependency-free so it is testable under `node --test`.

/** `null` = known root; a missing key = not known yet. */
export type ParentIndex = Record<string, string | null>

/**
 * Status variants that mean "this session is still doing work". `idle` is the
 * only settled variant the daemon reports; `blocked` (provider fallback
 * exhausted, awaiting retry) and `monitoring` (a durable background op) are
 * outstanding work, not finished work.
 */
const WORKING = new Set(["busy", "retry", "blocked", "monitoring"])

export function isWorkingStatus(status: { type?: unknown } | undefined | null): boolean {
  return typeof status?.type === "string" && WORKING.has(status.type)
}

export function workingSessionIDs(statuses: Record<string, { type?: unknown } | undefined> | null | undefined): string[] {
  return Object.entries(statuses ?? {}).flatMap(([id, status]) => (isWorkingStatus(status) ? [id] : []))
}

/**
 * Where a session sits relative to `rootID`, walking known parent links only.
 *
 * - `descendant`: the chain reaches `rootID`.
 * - `elsewhere`: the chain reaches a different known root (`null`), or cycles
 *   (malformed data is nobody's worker).
 * - `unplaced`: the chain stops at a link we do not know yet — a lookup that
 *   is pending or failed. That is partial knowledge, not a root (#53 review).
 *
 * No depth cap: `seen` guarantees termination, and a walk can never be longer
 * than the index it walks. A real daemon tree measured 36 deep (#53 review).
 */
export type Placement = "descendant" | "elsewhere" | "unplaced"

export function placementOf(id: string, rootID: string | undefined, parents: ParentIndex): Placement {
  const seen = new Set<string>([id])
  let current = id
  for (;;) {
    if (!(current in parents)) return "unplaced"
    const parent = parents[current]
    if (!parent) return "elsewhere"
    if (parent === rootID) return "descendant"
    if (seen.has(parent)) return "elsewhere"
    seen.add(parent)
    current = parent
  }
}

/** True when `id` is a strict descendant of `rootID`. Unknown links and cycles answer false. */
export function descendsFrom(id: string, rootID: string, parents: ParentIndex): boolean {
  if (!id || id === rootID) return false
  return placementOf(id, rootID, parents) === "descendant"
}

/**
 * The first session on `id`'s chain whose parent is not known yet, or
 * undefined when the chain is fully resolved (reaches a root) or cyclic. This
 * is the one id worth asking the server about next.
 */
export function unresolvedAncestor(id: string, parents: ParentIndex): string | undefined {
  const seen = new Set<string>()
  let current = id
  for (;;) {
    if (seen.has(current)) return undefined
    seen.add(current)
    if (!(current in parents)) return current
    const parent = parents[current]
    if (!parent) return undefined
    current = parent
  }
}

/** Parent links a batch of sessions vouches for. Roots are recorded as `null`. */
export function parentLinks(sessions: ReadonlyArray<{ id?: string; parentID?: string | null } | null | undefined>): ParentIndex {
  const links: ParentIndex = {}
  for (const session of sessions ?? []) {
    if (!session?.id) continue
    links[session.id] = session.parentID || null
  }
  return links
}
