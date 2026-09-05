// What a session actually wants from you.
//
// The list had three states — busy, retry, idle — where "idle" covered three
// genuinely different situations that call for different reactions:
//
//   - the run is **blocked on you**: a tool is waiting for approval, or the
//     agent asked a question. Nothing moves until you answer.
//   - the run **finished and you haven't looked**: there is a result to read.
//   - the session is **quiet and seen**: nothing to do.
//
// Collapsing those into one grey "idle" means the one that needs you in the
// next ten seconds looks exactly like the one you finished with yesterday.
//
// The inputs were all present already and simply never combined: pending
// permissions and questions are tracked per session for *every* session (not
// just the open one), and `session.time.updated` moves whenever a session
// produces anything. The only genuinely new piece is remembering when you last
// opened a session, which is what turns "updated" into "updated since you
// looked".

export type Attention =
  /** Blocked on the user: a permission or question is pending. */
  | "needs-attention"
  /** Running. */
  | "busy"
  /** Running, but retrying after a failure. */
  | "retry"
  /** Finished, with output the user has not seen. */
  | "complete"
  /** Quiet, and nothing unseen. */
  | "idle"

export interface AttentionInput {
  /** Server status over SSE: "busy" | "retry" | "idle" | undefined. */
  status?: string
  pendingPermissions?: number
  pendingQuestions?: number
  /** session.time.updated */
  updatedAt?: number
  /** When this client last opened the session; undefined if never. */
  lastViewedAt?: number
  /**
   * When a reader explicitly sent this session back to the unread queue
   * (server-owned; see src/lib/session-read-state.ts). Undefined = not marked.
   */
  markedUnreadAt?: number
}

/**
 * Classify a session.
 *
 * Order matters, and "needs attention" deliberately outranks "busy": a session
 * with a pending permission is *reported* busy by the server, because the run
 * has not ended — but it is not progressing, and it is the one case where the
 * user is the bottleneck. Ranking busy first would bury exactly the state that
 * most needs surfacing.
 */
export function attentionFor(input: AttentionInput): Attention {
  const blocked = (input.pendingPermissions ?? 0) > 0 || (input.pendingQuestions ?? 0) > 0
  if (blocked) return "needs-attention"

  if (input.status === "retry") return "retry"
  if (input.status === "busy") return "busy"

  // An explicit mark is a stronger statement than the activity heuristic below
  // — the reader has already opened this session (which is what stamps
  // lastViewedAt) and asked for it back anyway. It sits *below* busy and
  // needs-attention on purpose: a marked session that is now blocked on a
  // permission still needs the user more urgently than one that is merely
  // waiting to be re-read.
  if (input.markedUnreadAt !== undefined) return "complete"

  // Never opened counts as unseen only if it has actually produced something;
  // a freshly created session with no activity is idle, not "complete".
  if (input.updatedAt && (input.lastViewedAt === undefined || input.updatedAt > input.lastViewedAt)) {
    return "complete"
  }

  return "idle"
}

/**
 * Sort weight — lower sorts first.
 *
 * Actionable states float to the top of a group, so a list of 30 sessions
 * leads with the ones that want something.
 */
export function attentionRank(attention: Attention): number {
  switch (attention) {
    case "needs-attention":
      return 0
    case "retry":
      return 1
    case "busy":
      return 2
    case "complete":
      return 3
    case "idle":
      return 4
  }
}

/** Short badge text. */
export function attentionLabel(attention: Attention): string {
  switch (attention) {
    case "needs-attention":
      return "needs you"
    case "retry":
      return "retry"
    case "busy":
      return "busy"
    case "complete":
      return "done"
    case "idle":
      return "idle"
  }
}

/**
 * Should the state be shown at all?
 *
 * "idle" is the resting state of most rows; badging every one of them is
 * noise that makes the meaningful badges harder to spot.
 */
export function isAttentionWorthShowing(attention: Attention): boolean {
  return attention !== "idle"
}

/**
 * Is this a state the user is expected to act on?
 *
 * Used for the stronger visual treatment — colour alone should not be the only
 * carrier, and this lets callers add an icon or weight consistently.
 */
export function isActionable(attention: Attention): boolean {
  return attention === "needs-attention"
}

/** Persisted map of sessionID -> when this client last opened it. */
export type LastViewedMap = Record<string, number>

/**
 * Bound on remembered sessions.
 *
 * Only used to answer "is there something here I haven't seen", so forgetting
 * an old session is harmless: it re-reads as unseen, which is the safe
 * direction to be wrong in — it over-reports rather than hiding a result.
 */
export const MAX_TRACKED_VIEWS = 300

/** Record a view, evicting the oldest once over budget. */
export function markViewed(map: LastViewedMap, sessionID: string, at: number): LastViewedMap {
  if (!sessionID) return map

  const next: LastViewedMap = { ...map, [sessionID]: at }
  const ids = Object.keys(next)
  if (ids.length <= MAX_TRACKED_VIEWS) return next

  const ordered = ids.sort((a, b) => next[a] - next[b])
  for (const id of ordered.slice(0, ids.length - MAX_TRACKED_VIEWS)) delete next[id]
  return next
}

/**
 * Parse the persisted blob.
 *
 * Tolerant by design: a corrupt or hand-edited value should cost the user
 * their read-state, not crash the session list on launch. Non-numeric and
 * negative entries are dropped rather than trusted into a comparison.
 */
export function parseLastViewed(raw: string | null | undefined): LastViewedMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const out: LastViewedMap = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[id] = value
    }
    return out
  } catch {
    return {}
  }
}
