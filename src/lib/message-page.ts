// Paging policy for a session transcript.
//
// The client used to have exactly one way to get more history: refetch the
// WHOLE session. `loadOlderMessages` called `session.messages(id)` with no
// limit, threw away everything it already had, and replaced it with the full
// history — then set `hasMore: false` because, tautologically, it had loaded
// everything.
//
// On a real session that is not a small cost. The largest session in this
// workspace holds 1,341 messages across 5,893 parts; the same unbounded call
// also sat in `refreshMessages` (every focus/resync) and in the SSE
// busy-session reconcile, which only ever needed the last message to decide
// whether a session had gone idle.
//
// The server has supported proper cursor paging the whole time:
//
//     GET /session/:id/message?limit=N            -> newest N
//     GET /session/:id/message?limit=N&before=C   -> the N older than cursor C
//
// responding with an `X-Next-Cursor` header when more remain (and omitting it
// when they do not). The client simply never read it.
//
// Everything here is pure so the merge and cursor rules are testable without a
// socket or a store.

import type { Message, Part } from "./sdk"

/** Case-insensitive: RN's Headers lowercases, some proxies do not. */
export const NEXT_CURSOR_HEADER = "x-next-cursor"

/**
 * Optimistic messages live only on the client until the server acknowledges
 * them. They must survive any merge, or a refresh racing a send deletes text
 * the user typed.
 */
export function isPendingMessage(message: Message): boolean {
  return message.id.startsWith("temp-")
}

/**
 * Read the paging cursor off a response.
 *
 * Absent means "no more history" — that is the server's signal, not an
 * inference from page size. Guessing from `items.length >= limit` is wrong on
 * the exact-multiple boundary: a session with precisely `limit` messages left
 * would report more, and the next fetch would come back empty.
 */
export function nextCursorFrom(headers: { get(name: string): string | null }): string | undefined {
  const raw = headers.get(NEXT_CURSOR_HEADER) ?? headers.get("X-Next-Cursor")
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Prepend an older page to the transcript.
 *
 * Ordering is oldest-first in the store (the inverted FlatList reverses for
 * display), so an older page goes in front. Dedupes on id because a message
 * can legitimately arrive twice — the page boundary can overlap a message that
 * landed over SSE while the fetch was in flight — and keeps the *existing*
 * copy, which is the one SSE has been keeping current.
 *
 * Pending messages are pinned to the end regardless of what the page contains:
 * they are newer than any server history by construction.
 */
export function mergeOlderPage(input: { existing: Message[]; older: Message[] }): Message[] {
  const existing = input.existing ?? []
  const older = input.older ?? []

  const seen = new Set(existing.map((m) => m.id))
  const prefix = older.filter((m) => !seen.has(m.id))

  const settled = existing.filter((m) => !isPendingMessage(m))
  const pending = existing.filter(isPendingMessage)
  return [...prefix, ...settled, ...pending]
}

/**
 * Merge the parts of an older page.
 *
 * Existing entries win: a part already in the store may have been mutated by a
 * streaming SSE update since the page was requested, and the fetched copy
 * could be a snapshot from before that.
 */
export function mergeOlderParts(
  existing: Record<string, Part[]>,
  older: Record<string, Part[]>,
): Record<string, Part[]> {
  return { ...(older ?? {}), ...(existing ?? {}) }
}

/**
 * How many messages to ask for when refreshing the open session.
 *
 * A refresh must not shrink the window: if the user paged back through 300
 * messages, refetching only the first page would make everything they scrolled
 * to vanish under them. So request at least as many as are currently loaded,
 * and never fewer than one page.
 *
 * Capped so a pathological session cannot turn a routine refresh back into the
 * unbounded fetch this module exists to remove.
 */
export const REFRESH_WINDOW_CAP = 400

export function refreshWindowSize(loadedCount: number, pageSize: number): number {
  const page = Math.max(1, pageSize)
  const loaded = Math.max(0, loadedCount)
  return Math.min(REFRESH_WINDOW_CAP, Math.max(page, loaded))
}
