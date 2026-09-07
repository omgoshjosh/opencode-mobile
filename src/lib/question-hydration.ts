// Pending questions, for every session this connection can hear from — not
// just the one on screen, and not the whole world either.
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

export interface ObservableSessionLike {
  id: string
  /** The project this session lives in. Absent means "wherever we are". */
  directory?: string
  /** `sessionID`s of the background workers this session reports running. */
  workers?: readonly string[]
}

/**
 * Which sessions' question events this connection will actually receive.
 *
 * `GET /question` is GLOBAL — "all pending question requests across all
 * sessions", with no directory filter (daemon `handlers/question.ts`). The SSE
 * bus that CLEARS them is not: `question.asked`/`replied`/`rejected` are only
 * forwarded when `event.location.directory === instance.directory`
 * (`handlers/event.ts`). So a snapshot entry from another project can never be
 * invalidated on this connection, and a worker would read "needs input"
 * forever — the exact stale-state class this work exists to remove.
 *
 * A session is observable when the client tracks it in the connected directory
 * (the session list is deliberately directory-less, so it spans projects), or
 * when it is a background worker of such a session — a worker is a child of
 * its parent's project, and rarely appears in the list itself.
 *
 * An unknown session directory is treated as the connected one: older servers
 * omit it, and refusing to show a question is worse than the leak we can no
 * longer prove. A `null`/`undefined` connection directory means the daemon
 * chose the scope for us, so nothing here can be ruled out.
 */
export function observableSessionIDs(
  sessions: readonly ObservableSessionLike[] | null | undefined,
  directory: string | null | undefined,
): Set<string> {
  const observable = new Set<string>()
  for (const session of sessions ?? []) {
    if (!session?.id) continue
    if (directory && session.directory && session.directory !== directory) continue
    observable.add(session.id)
    for (const worker of session.workers ?? []) if (worker) observable.add(worker)
  }
  return observable
}

/**
 * The snapshot replaces the map wholesale, because a question answered while
 * the app was disconnected has no `question.replied` event to remove it and a
 * union would keep it pending forever.
 *
 * For the same reason the snapshot is first narrowed to `observable`: an entry
 * whose session this connection cannot hear from has no event that could ever
 * clear it. Dropping it loses a question we could not have shown truthfully;
 * keeping it pins a worker at "needs input" for the life of the connection.
 *
 * In-flight events are NOT narrowed — they arrived on the directory-scoped bus,
 * so the server has already vouched for them, and the set of tracked sessions
 * may simply not have caught up yet.
 *
 * That in-flight exception is what SSE delivered while the GET was on the wire:
 * those events are newer than the snapshot, so an arrival is added back and a
 * reply or rejection wins over a snapshot entry that had not yet been resolved
 * server-side when the response was assembled.
 */
export function mergeQuestionSnapshot<T extends PendingQuestionLike>(
  snapshot: readonly T[] | null | undefined,
  inFlight: { added: readonly T[]; removed: readonly string[] },
  observable: ReadonlySet<string>,
): Record<string, T[]> {
  const removed = new Set(inFlight?.removed ?? [])
  const kept = (snapshot ?? []).filter((question) => !!question && observable.has(question.sessionID) && !removed.has(question.id))
  const seen = new Set(kept.map((question) => question.id))
  const added = (inFlight?.added ?? []).filter((question) => !removed.has(question.id) && !seen.has(question.id))
  return indexQuestionsBySession([...kept, ...added])
}
