// Server-backed read state: "I've dealt with this one" / "put it back in my queue".
//
// `lastViewed` (session-attention.ts) already answers "has this session moved
// since I opened it" — but only for THIS device, and only in the direction the
// activity clock pushes it. It cannot express the thing a reader actually wants
// after skimming a long run: *leave it unread, I'll come back to it*. And
// because it lives in AsyncStorage, a reader who marks something on their phone
// sees it read again on the tablet.
//
// So the mark is server state. The daemon owns `markedUnreadAt`; this module is
// only the client-side projection of it, plus a small on-disk cache so a cold
// start paints marks before hydration lands.
//
// The revision guard is the whole design. Every server write stamps a new
// `timeUpdated`, and a client echoes the last one it saw as `expectedRevision`.
// A client that is behind has not observed the newest mark, so the server drops
// its intent entirely rather than letting it clear a mark it never saw or
// resurrect one somebody else already cleared. The same rule applies locally in
// `applyServerState`: a state carrying an older revision than the one we hold is
// a late-arriving echo, not news.

/** sessionID -> the mark, and the server revision it came from. */
export type ReadStateMap = Record<string, { markedUnreadAt?: number; revision: number }>

/** The server's `OpencodeXSessionState` — only the fields this client reads. */
export interface ServerSessionState {
  sessionID: string
  markedUnreadAt?: number
  /** The persisted revision. Echoed back as `expectedRevision` on writes. */
  timeUpdated: number
}

/** Is this session explicitly marked unread right now? */
export function isMarkedUnread(map: ReadStateMap, sessionID: string): boolean {
  return map[sessionID]?.markedUnreadAt !== undefined
}

/** The revision to echo as `expectedRevision`. 0 means "never seen any state". */
export function revisionFor(map: ReadStateMap, sessionID: string): number {
  return map[sessionID]?.revision ?? 0
}

/**
 * Fold a server state into the map.
 *
 * Accepted only when its revision is at least the one we already hold. SSE,
 * hydration and a PATCH response all carry the same state, and they race: the
 * event for a write can land before that write's own response returns. Taking
 * `>=` rather than `>` keeps the replay idempotent (same revision, same values)
 * while still rejecting a genuinely older snapshot from a slow hydration page.
 */
export function applyServerState(map: ReadStateMap, state: ServerSessionState): ReadStateMap {
  if (!state?.sessionID) return map
  if (!Number.isFinite(state.timeUpdated) || state.timeUpdated < 0) return map
  const current = map[state.sessionID]
  if (current && state.timeUpdated < current.revision) return map

  const next: ReadStateMap[string] = { revision: state.timeUpdated }
  if (typeof state.markedUnreadAt === "number" && Number.isFinite(state.markedUnreadAt) && state.markedUnreadAt >= 0) {
    next.markedUnreadAt = state.markedUnreadAt
  }
  if (current && current.revision === next.revision && current.markedUnreadAt === next.markedUnreadAt) return map
  return { ...map, [state.sessionID]: next }
}

/**
 * Show the mark immediately, before the server answers.
 *
 * The revision is deliberately left where it was: it is the server's number,
 * and inventing one here would make the next write's `expectedRevision` a lie.
 * The server's echo (or the SSE event) supplies the real revision moments later.
 */
export function optimisticMarkUnread(map: ReadStateMap, sessionID: string, at: number): ReadStateMap {
  if (!sessionID) return map
  return { ...map, [sessionID]: { ...map[sessionID], revision: revisionFor(map, sessionID), markedUnreadAt: at } }
}

/** Clear the mark locally. Same revision rule as `optimisticMarkUnread`. */
export function optimisticMarkRead(map: ReadStateMap, sessionID: string): ReadStateMap {
  const current = map[sessionID]
  if (!current || current.markedUnreadAt === undefined) return map
  return { ...map, [sessionID]: { revision: current.revision } }
}

/** Forget a session entirely — used when it is deleted. */
export function dropReadState(map: ReadStateMap, sessionID: string): ReadStateMap {
  if (!(sessionID in map)) return map
  const next = { ...map }
  delete next[sessionID]
  return next
}

export function serializeReadState(map: ReadStateMap): string {
  return JSON.stringify(map)
}

/**
 * Parse the cached blob.
 *
 * Same tolerance as `parseLastViewed`: the server is authoritative, so a corrupt
 * or hand-edited cache should cost a frame of stale marks, never a crash on
 * launch. Entries that are not well-formed are dropped rather than trusted into
 * a revision comparison.
 */
export function parseReadState(raw: string | null | undefined): ReadStateMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const out: ReadStateMap = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue
      const { revision, markedUnreadAt } = value as { revision?: unknown; markedUnreadAt?: unknown }
      if (typeof revision !== "number" || !Number.isFinite(revision) || revision < 0) continue
      const entry: ReadStateMap[string] = { revision }
      if (typeof markedUnreadAt === "number" && Number.isFinite(markedUnreadAt) && markedUnreadAt >= 0) {
        entry.markedUnreadAt = markedUnreadAt
      }
      out[id] = entry
    }
    return out
  } catch {
    return {}
  }
}
