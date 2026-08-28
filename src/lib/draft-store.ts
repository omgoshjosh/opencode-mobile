// Composer drafts, per session.
//
// Typing half a prompt, tapping away to check another session, and coming
// back to an empty composer loses real work. Drafts persist per-session and
// restore on return.
//
// The map is bounded and self-cleaning: empty text deletes the entry (a
// cleared composer is not a draft), and the oldest drafts fall off past the
// cap so storage cannot grow forever.
//
// Pure, so the eviction rules are testable under plain `node --test`.

export interface DraftEntry {
  text: string
  at: number
}

export type DraftMap = Record<string, DraftEntry>

export const MAX_DRAFTS = 50

/** Whether persisting text would change the bounded draft map. */
export function shouldWriteDraft(map: DraftMap, sessionID: string, text: string): boolean {
  const current = map[sessionID]?.text
  if (!text.trim()) return current !== undefined
  return current !== text
}

export function putDraft(map: DraftMap, sessionID: string, text: string, at: number): DraftMap {
  const next: DraftMap = { ...map }
  if (!text.trim()) {
    delete next[sessionID]
    return next
  }
  next[sessionID] = { text, at }
  const ids = Object.keys(next)
  if (ids.length > MAX_DRAFTS) {
    ids
      .sort((a, b) => next[a].at - next[b].at)
      .slice(0, ids.length - MAX_DRAFTS)
      .forEach((id) => delete next[id])
  }
  return next
}

export function parseDrafts(raw: string | null): DraftMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as DraftMap
    if (typeof parsed !== "object" || parsed === null) return {}
    const out: DraftMap = {}
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.text === "string" && entry.text.trim() && typeof entry.at === "number") {
        out[id] = entry
      }
    }
    return out
  } catch {
    return {}
  }
}
