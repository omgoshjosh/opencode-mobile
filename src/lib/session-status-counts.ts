// Aggregated session status for a group header on the sessions list.
//
// A group header (a directory, a swarm, a swarm root session — see M-8's
// group-by picker) summarises the live status of its members. Rendering every
// possible status would mean rows like "0 busy · 0 retry · 7 idle", which is
// noise: the useful signal is almost always "is anything running?".
//
// So: count only statuses actually present, and order them by how much they
// warrant attention — busy, then retry, then idle — so the first badge is the
// one worth reading. A completely idle group collapses to a single "7 idle"
// badge rather than a row of zeroes.
//
// Status comes from useEvents().sessionStatus, which is SSE-driven. Sessions
// with no entry there have never reported a status this run and are treated as
// idle, which matches how the rest of the UI reads an absent status.
//
// Dependency-free so it's testable under plain `node --test`.

export type SessionStatusType = "busy" | "retry" | "idle"

export interface StatusCount {
  status: SessionStatusType
  count: number
}

// Most attention-worthy first. Also the tie-break for equal counts, so the
// order is stable rather than dependent on object key iteration.
const STATUS_PRIORITY: SessionStatusType[] = ["busy", "retry", "idle"]

export function statusCounts(
  sessionIDs: string[],
  sessionStatus: Record<string, { type: string } | undefined> | null | undefined,
): StatusCount[] {
  const tally = new Map<SessionStatusType, number>()

  for (const id of sessionIDs) {
    const raw = sessionStatus?.[id]?.type
    // An unknown/absent status is idle: the session simply hasn't reported
    // anything on this connection yet.
    const status: SessionStatusType =
      raw === "busy" || raw === "retry" ? raw : "idle"
    tally.set(status, (tally.get(status) ?? 0) + 1)
  }

  return STATUS_PRIORITY.filter((status) => (tally.get(status) ?? 0) > 0).map((status) => ({
    status,
    count: tally.get(status) as number,
  }))
}

/** True when any member is actively working — for tinting the header. */
export function hasActiveSession(counts: StatusCount[]): boolean {
  return counts.some((c) => (c.status === "busy" || c.status === "retry") && c.count > 0)
}
