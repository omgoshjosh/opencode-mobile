// One line of "what is this session actually talking about", for the list.
//
// The session list shows a title, a timestamp and some badges. The title is
// often set once at creation and never revisited, so a list of 50 sessions
// gives very little sense of what is happening in any of them.
//
// The obvious implementation — fetch the last message per row — costs one
// request per session and is why this did not already exist. But the client is
// already receiving every part of every message for every session on the
// global SSE stream; it was simply discarding anything not belonging to the
// open session. Keeping the last line of text per session out of that stream
// costs one short string per session and no requests at all.
//
// Deliberately not a message cache: this is a *label*. It holds truncated text
// and nothing else, so it stays cheap enough to keep for every session the
// stream mentions.

/** Longer than a list row can show; the row truncates visually too. */
export const PREVIEW_MAX_CHARS = 140

/** Bound on tracked sessions, so a long-lived stream cannot grow it forever. */
export const MAX_TRACKED_PREVIEWS = 200

export interface SessionPreview {
  text: string
  /** For eviction, and to ignore out-of-order arrivals. */
  at: number
}

// Deliberately no `role`. Part events carry no role, and message ids do not
// encode one (both user and assistant messages are `msg_<hex>`), so labelling
// the line "you" vs "assistant" would mean either an extra lookup or a guess.
// The text alone is what makes the row useful.

export type PreviewMap = Record<string, SessionPreview>

/**
 * Normalise part text into a single line.
 *
 * Transcript text is markdown with newlines, code fences and long runs of
 * whitespace; rendered raw in a one-line row it produces ragged gaps and
 * stray fence characters. Returns null when nothing meaningful is left, so
 * callers can leave the previous preview standing rather than blanking it.
 */
export function previewText(raw: string | null | undefined, max: number = PREVIEW_MAX_CHARS): string | null {
  if (!raw) return null
  const flattened = raw
    .replace(/```[\s\S]*?```/g, " ") // fenced code says nothing useful at this size
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
  if (flattened.length === 0) return null
  return flattened.length > max ? `${flattened.slice(0, max - 1).trimEnd()}…` : flattened
}

/**
 * Record a preview, keeping the newest per session.
 *
 * Out-of-order arrivals are ignored rather than applied: SSE parts for a
 * streaming message arrive repeatedly as it grows, and a late-delivered
 * earlier chunk would otherwise rewind the line to a truncated prefix.
 */
export function putPreview(
  previews: PreviewMap,
  sessionID: string,
  preview: { text: string | null; at: number },
): PreviewMap {
  if (!sessionID || !preview.text) return previews

  const existing = previews[sessionID]
  if (existing && existing.at > preview.at) return previews

  const next: PreviewMap = {
    ...previews,
    [sessionID]: { text: preview.text, at: preview.at },
  }

  const ids = Object.keys(next)
  if (ids.length <= MAX_TRACKED_PREVIEWS) return next

  const ordered = ids.sort((a, b) => next[a].at - next[b].at)
  for (const id of ordered.slice(0, ids.length - MAX_TRACKED_PREVIEWS)) delete next[id]
  return next
}

/** Forget a session — used when one is deleted. */
export function dropPreview(previews: PreviewMap, sessionID: string): PreviewMap {
  if (!previews?.[sessionID]) return previews
  const next = { ...previews }
  delete next[sessionID]
  return next
}
