// Walking the session tree to its root.
//
// A swarm doing large-scale work does not produce a flat root-plus-children
// shape. The root spawns role sessions, and those roles spawn their own
// subagents via `task` calls, so the real structure is a tree of arbitrary
// depth. Two places assumed depth 1 and both got it wrong:
//
//   - `normalizeSessions` kept children whose `parentID` was a visible root.
//     A grandchild's parent is another *child*, so grandchildren failed the
//     test and were dropped from the session list entirely — the deeper a
//     swarm's task graph went, the more of it was simply invisible.
//   - `groupKey`'s "root" mode returned `parentID || id`. For a grandchild
//     that is its parent's id, so it formed its own group next to the swarm
//     instead of nesting inside it.
//
// Resolving the actual ancestor fixes both, and is the difference between
// "swarm root" meaning "one level of nesting" and meaning what it says.

export interface TreeSession {
  id: string
  parentID?: string
}

/**
 * The id of the topmost ancestor, or the session's own id if it is a root.
 *
 * Guards against cycles and against parents missing from the map. Both are
 * real: the session list is capped, so a child's parent is frequently absent,
 * and returning the deepest id we could actually resolve keeps such a session
 * grouped with its visible relatives rather than vanishing.
 */
export function rootIDOf(session: TreeSession, byID: Map<string, TreeSession>): string {
  let current = session
  const seen = new Set<string>([current.id])

  while (current.parentID) {
    const parent = byID.get(current.parentID)
    // Parent not loaded — this is as far up as we can see.
    if (!parent) return current.parentID
    // Cycle: malformed data must not hang the list render.
    if (seen.has(parent.id)) return current.id
    seen.add(parent.id)
    current = parent
  }

  return current.id
}

/** Index a session collection for repeated ancestor lookups. */
export function indexByID<T extends TreeSession>(sessions: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const session of sessions ?? []) map.set(session.id, session)
  return map
}

/**
 * Every session that descends from one of `rootIDs`, at any depth.
 *
 * Replaces a direct-parent membership test, which silently truncated the tree
 * at the first generation.
 */
export function descendantsOf<T extends TreeSession>(sessions: T[], rootIDs: Set<string>): T[] {
  const byID = indexByID(sessions)
  return (sessions ?? []).filter((session) => {
    if (!session.parentID) return false
    return rootIDs.has(rootIDOf(session, byID))
  })
}

/**
 * Depth below the root, for indenting a nested list.
 *
 * Capped by the caller if it wants to bound indentation; this reports the
 * truth so a deep task graph is legible as deep rather than flattened.
 */
export function depthOf(session: TreeSession, byID: Map<string, TreeSession>): number {
  let depth = 0
  let current = session
  const seen = new Set<string>([current.id])

  while (current.parentID) {
    const parent = byID.get(current.parentID)
    if (!parent || seen.has(parent.id)) return depth + 1
    seen.add(parent.id)
    current = parent
    depth++
  }

  return depth
}
