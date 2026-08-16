// A small LRU of recently-viewed transcripts.
//
// The sessions store holds exactly one session: `currentSession` plus a single
// `messages`/`parts` pair, both overwritten on every selection. Bouncing
// between two sessions therefore costs a full cold fetch each way, every time,
// and the screen shows a spinner over content the client had moments ago.
//
// Caching transcripts is also how the app can afford to know anything about a
// session it does not currently have open — a preview line on the list, say,
// or applying an SSE update to a session in the background.
//
// The retention rule matters as much as the caching. Naively keeping every
// session visited would grow without bound; the largest session here is 1,341
// messages / 5,893 parts, so a handful of those is real memory on a device
// like a Pixel 3 XL. So: few entries, and each entry capped.
//
// Pure and store-free, so eviction and capping are testable directly.

import type { Message, Part } from "./sdk"

/**
 * How many sessions to retain.
 *
 * Small on purpose. This exists to make *switching back* free — the realistic
 * pattern is alternating between a couple of sessions, not touring dozens.
 * Every extra slot is another full transcript held in memory for a case that
 * rarely pays off.
 */
export const MAX_CACHED_SESSIONS = 5

/**
 * Cap on messages retained per cached session.
 *
 * A cache entry only has to make re-entry instant; the transcript pages in
 * more on demand. Retaining a 1,341-message history per slot would defeat the
 * point of paging it in the first place.
 */
export const MAX_CACHED_MESSAGES = 60

export interface CachedTranscript {
  messages: Message[]
  parts: Record<string, Part[]>
  /** Cursor for older history, so a restored session can keep paging. */
  nextCursor?: string
  /** Last touch, for eviction. */
  touchedAt: number
}

export type TranscriptCache = Record<string, CachedTranscript>

/**
 * Trim an entry to the newest MAX_CACHED_MESSAGES, dropping orphaned parts.
 *
 * Parts are keyed by message id, so dropping messages without pruning parts
 * would leak the bulkier half of the data — parts outnumber messages roughly
 * five to one here.
 */
export function capTranscript(input: {
  messages: Message[]
  parts: Record<string, Part[]>
  max?: number
}): { messages: Message[]; parts: Record<string, Part[]> } {
  const max = input.max ?? MAX_CACHED_MESSAGES
  const messages = input.messages ?? []
  if (messages.length <= max) {
    return { messages, parts: input.parts ?? {} }
  }

  const kept = messages.slice(messages.length - max)
  const keptIDs = new Set(kept.map((m) => m.id))
  const parts: Record<string, Part[]> = {}
  for (const [messageID, value] of Object.entries(input.parts ?? {})) {
    if (keptIDs.has(messageID)) parts[messageID] = value
  }
  return { messages: kept, parts }
}

/**
 * Insert/refresh an entry, then evict the least-recently-touched over budget.
 *
 * Returns a new object; callers set it straight into the store.
 */
export function putTranscript(
  cache: TranscriptCache,
  sessionID: string,
  entry: Omit<CachedTranscript, "touchedAt"> & { touchedAt?: number },
  now: number = Date.now(),
): TranscriptCache {
  if (!sessionID) return cache

  const capped = capTranscript({ messages: entry.messages, parts: entry.parts })
  const next: TranscriptCache = {
    ...cache,
    [sessionID]: {
      messages: capped.messages,
      parts: capped.parts,
      nextCursor: entry.nextCursor,
      touchedAt: entry.touchedAt ?? now,
    },
  }

  const ids = Object.keys(next)
  if (ids.length <= MAX_CACHED_SESSIONS) return next

  // Oldest touch first; the session just written is necessarily newest, so it
  // can never evict itself.
  const ordered = ids.sort((a, b) => next[a].touchedAt - next[b].touchedAt)
  for (const id of ordered.slice(0, ids.length - MAX_CACHED_SESSIONS)) {
    delete next[id]
  }
  return next
}

/** Read an entry without mutating recency — callers touch it on real use. */
export function getTranscript(cache: TranscriptCache, sessionID: string): CachedTranscript | undefined {
  return cache?.[sessionID]
}

/**
 * Drop one session's entry.
 *
 * Used when a session is deleted, and when a fetch for it fails in a way that
 * suggests the cached copy is wrong — a stale transcript shown confidently is
 * worse than a spinner.
 */
export function dropTranscript(cache: TranscriptCache, sessionID: string): TranscriptCache {
  if (!cache?.[sessionID]) return cache
  const next = { ...cache }
  delete next[sessionID]
  return next
}

/**
 * Should a cached transcript be shown while a refresh runs?
 *
 * Yes whenever there is one: the entry came from this same server and SSE has
 * been updating it. Showing it immediately and reconciling underneath is what
 * removes the spinner; the alternative — blocking on the network before
 * showing anything — is the behaviour being fixed.
 */
export function canRenderFromCache(entry: CachedTranscript | undefined): boolean {
  return Boolean(entry && entry.messages.length > 0)
}
