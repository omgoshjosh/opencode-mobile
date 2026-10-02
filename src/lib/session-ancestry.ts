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

/** Deep enough for any real swarm, small enough that malformed data stays cheap. */
export const MAX_ANCESTRY_DEPTH = 32

/** True when `id` is a strict descendant of `rootID`. Unknown links and cycles answer false. */
export function descendsFrom(id: string, rootID: string, parents: ParentIndex): boolean {
  if (!id || id === rootID) return false
  const seen = new Set<string>([id])
  let current = id
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth++) {
    const parent = parents[current]
    if (!parent) return false
    if (parent === rootID) return true
    if (seen.has(parent)) return false
    seen.add(parent)
    current = parent
  }
  return false
}

/**
 * The first session on `id`'s chain whose parent is not known yet, or
 * undefined when the chain is fully resolved (reaches a root), cyclic, or too
 * deep. This is the one id worth asking the server about next.
 */
export function unresolvedAncestor(id: string, parents: ParentIndex): string | undefined {
  const seen = new Set<string>()
  let current = id
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth++) {
    if (seen.has(current)) return undefined
    seen.add(current)
    if (!(current in parents)) return current
    const parent = parents[current]
    if (!parent) return undefined
    current = parent
  }
  return undefined
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
