import type { Session } from "./sdk"

/**
 * Cold-start honesty for the sessions list.
 *
 * Without a snapshot, a slow backend means a blank list behind a spinner —
 * the glance view is exactly the screen that must work when the farm is
 * misbehaving. So the last successful list is persisted and painted
 * immediately, but never silently: anything not confirmed by a live fetch
 * carries an "as of" timestamp the UI must show.
 *
 * Persisted-data rule (src/lib/persisted-keys.test.ts): this snapshot holds
 * session METADATA — ids, titles, timestamps, directories, model refs. Titles
 * are model-derived, same as the already-reviewed PREVIEWS_KEY lines: they are
 * rendered as inert text in the list and never fed back into any model or
 * request. `revert`/`share` state is deliberately dropped — acting on stale
 * versions of those could target the wrong message.
 */

/** Bound the write: newest-first slice keeps the snapshot a paint aid, not a database. */
export const SNAPSHOT_MAX_SESSIONS = 500

export interface SessionsSnapshot {
  savedAt: number
  sessions: Session[]
}

export function serializeSnapshot(sessions: Session[], savedAt: number): string {
  const trimmed = sessions.slice(0, SNAPSHOT_MAX_SESSIONS).map((s) => {
    const { revert: _revert, share: _share, ...keep } = s
    return keep
  })
  return JSON.stringify({ savedAt, sessions: trimmed })
}

/** Tolerant parse: a corrupt or legacy snapshot must degrade to "no snapshot", never crash the list. */
export function parseSnapshot(raw: string | null | undefined): SessionsSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.savedAt !== "number" || !Array.isArray(parsed?.sessions)) return null
    const sessions = parsed.sessions.filter(
      (s: unknown): s is Session =>
        typeof (s as Session)?.id === "string" && typeof (s as Session)?.time?.updated === "number",
    )
    return { savedAt: parsed.savedAt, sessions }
  } catch {
    return null
  }
}

/**
 * What (if anything) the list must admit about its data's age.
 *
 * - "snapshot": painting from disk, live refresh not yet landed.
 * - "refresh-failed": a live refresh failed; rows are whatever loaded last.
 * Fresh network data (or an empty list with nothing to mislead about) needs
 * no banner.
 */
export type ListFreshness = { kind: "snapshot" | "refresh-failed"; asOf: number } | null

export function listFreshness(args: {
  hasSessions: boolean
  /** Where the rows currently on screen came from. */
  source: "network" | "snapshot" | null
  /** Timestamp of the data on screen (snapshot savedAt or last successful load). */
  asOf: number | null
  /** The most recent live refresh attempt failed. */
  loadFailed: boolean
}): ListFreshness {
  if (!args.hasSessions || args.asOf === null) return null
  if (args.loadFailed) return { kind: "refresh-failed", asOf: args.asOf }
  if (args.source === "snapshot") return { kind: "snapshot", asOf: args.asOf }
  return null
}

/** "just now" | "4m ago" | "3h ago" | "2d ago" — coarse on purpose; this labels staleness, not history. */
export function ageLabel(asOf: number, now: number): string {
  const mins = Math.floor(Math.max(0, now - asOf) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
