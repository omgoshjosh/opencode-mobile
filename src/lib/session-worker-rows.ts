import type { Session } from "./sdk"

export type SessionWorkerRow = { session: Session; depth: 0 | 1 }

/** Visible roots own direct children; no child may become a root row. */
export function sessionWorkerRows(sessions: Session[], expanded: Set<string>): SessionWorkerRow[] {
  const roots = sessions.filter((session) => !session.parentID)
  const rootIDs = new Set(roots.map((session) => session.id))
  const children = new Map<string, Session[]>()
  for (const session of sessions) {
    if (!session.parentID || !rootIDs.has(session.parentID)) continue
    const owned = children.get(session.parentID) ?? []
    owned.push(session)
    children.set(session.parentID, owned)
  }
  return roots.flatMap((root) => [
    { session: root, depth: 0 as const },
    ...(expanded.has(root.id) ? (children.get(root.id) ?? []).map((session) => ({ session, depth: 1 as const })) : []),
  ])
}
