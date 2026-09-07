// Pending questions, for every session — not just the one on screen.
//
// `useEvents.questions` was only ever hydrated by `refreshPending`, which
// filters `GET /question` down to the session being entered. Live
// `question.asked` events do populate the map for any session, but SSE
// resumes from "now" and never replays, so a child agent that asked before
// the app connected stayed invisible: the parent's chip said "working" and
// the only way to find the blocked child was to open it.
//
// Pure, so the in-flight race below is testable under plain `node --test`.

export interface PendingQuestionLike {
  id: string
  sessionID: string
}

/** Group a `GET /question` list by the session that is blocked on it. */
export function indexQuestionsBySession<T extends PendingQuestionLike>(list: readonly T[] | null | undefined): Record<string, T[]> {
  const bySession: Record<string, T[]> = {}
  for (const question of list ?? []) {
    if (!question?.sessionID || !question.id) continue
    ;(bySession[question.sessionID] ??= []).push(question)
  }
  return bySession
}

/**
 * The snapshot replaces the map wholesale, because a question answered while
 * the app was disconnected has no `question.replied` event to remove it and a
 * union would keep it pending forever.
 *
 * The exception is what SSE delivered while the GET was in flight: those
 * events are newer than the snapshot, so an arrival is added back and a reply
 * or rejection wins over a snapshot entry that had not yet been resolved
 * server-side when the response was assembled.
 */
export function mergeQuestionSnapshot<T extends PendingQuestionLike>(
  snapshot: readonly T[] | null | undefined,
  inFlight: { added: readonly T[]; removed: readonly string[] },
): Record<string, T[]> {
  const removed = new Set(inFlight?.removed ?? [])
  const kept = (snapshot ?? []).filter((question) => !removed.has(question.id))
  const seen = new Set(kept.map((question) => question.id))
  const added = (inFlight?.added ?? []).filter((question) => !removed.has(question.id) && !seen.has(question.id))
  return indexQuestionsBySession([...kept, ...added])
}
