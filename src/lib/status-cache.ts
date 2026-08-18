// Persisted last-known session statuses, for the sessions list at cold start.
//
// sessionStatus is SSE-fed and lived only in memory: relaunching the app
// rendered every row idle-grey until each session happened to speak again —
// a supervisor opening the app to check on their agents saw "all quiet",
// which was a guess, not information. The last-known map is now stored
// eagerly on every status change and restored at boot.
//
// Only busy/retry entries are stored. Idle is the default render — writing
// it adds bytes but no pixels — so the cache stays tiny and self-pruning:
// a session's terminal transition to idle deletes its entry.
//
// Staleness is handled, not ignored: restored "busy" is validated against
// the server by the busy-session resync as soon as the event stream shows
// life (the resync gate now keys on "any busy statuses present", which
// covers both reconnects and disk-restored state).
//
// Pure, so the filtering/parsing is testable under plain `node --test`.

export interface CachedStatus {
  // retry degrades to busy on disk: the live retry status carries attempt/
  // message the cache cannot honestly reproduce, and both render as "still
  // moving". The post-restore resync restores precision.
  type: "busy"
}

export type StatusCache = Record<string, CachedStatus>

/** Strip a live status map down to what is worth persisting. */
export function toStatusCache(map: Record<string, { type: string }>): StatusCache {
  const out: StatusCache = {}
  for (const [id, status] of Object.entries(map)) {
    if (status?.type === "busy" || status?.type === "retry") out[id] = { type: "busy" }
  }
  return out
}

/** Parse stored JSON defensively: garbage in, empty map out — never a throw. */
export function parseStatusCache(raw: string | null): StatusCache {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as StatusCache
    if (typeof parsed !== "object" || parsed === null) return {}
    const out: StatusCache = {}
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry?.type === "busy") out[id] = { type: entry.type }
    }
    return out
  } catch {
    return {}
  }
}
