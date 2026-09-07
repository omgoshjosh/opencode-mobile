// What a background worker is doing, in the only vocabulary the wire can back.
//
// `workersRunningLabel` said "3 workers running" whether all three were
// grinding or one had been blocked on a question for ten minutes. This module
// is the mapping from the typed fields the daemon actually sends to the words
// and the hue the chip, the list rows and the jobs sheet all show.
//
// Pure — no store imports — so every rule here is testable under `node --test`.
//
// WHAT EACH STATE WOULD NEED, AND WHAT EXISTS TODAY (audited against daemon
// a2ddc01). `session.status.background` is
// `{ running: boolean, jobs: [{ id, sessionID, status, role, title, owner }] }`
// and `status` is a ONE-VALUED literal ("running"): no `since`, no completion
// event, no failure event. A finished job simply disappears from the next
// `session.status`.
//
// - `awaiting-answer` — PRODUCIBLE. A `GET /question` entry whose `sessionID`
//   equals the job's. A child blocked on a question still reports
//   `session.status.type === "busy"`, so this join is the only evidence.
// - `failed` — NOT PRODUCIBLE. No error field, no failure event on a job.
// - `stalled` — NOT PRODUCIBLE. No `since`, no progress timestamp, nothing to
//   measure "not moving" against.
// - `working` — PRODUCIBLE. The job is present in `jobs[]`.
// - `queued` — NOT PRODUCIBLE. Admission is not reported; a job appears only
//   once it is already running.
// - `ended` — CLIENT-OBSERVED ONLY. The job left `jobs[]`, which is ambiguous:
//   finished, OR the daemon restarted, OR a decode failed.
//
// Only `awaiting-answer`, `working` and `ended` are producible today. The other
// three are defined here so the priority order and the copy are settled before
// the wire grows the fields, and so nothing is tempted to infer them from
// status text, elapsed time, or absence. Do not guess a state.

import { DOT_BUSY, DOT_COMPLETE, DOT_IDLE, DOT_NEEDS_ATTENTION, DOT_RETRY } from "./session-triage"
import type { PendingQuestionLike } from "./question-hydration"

export type { PendingQuestionLike }

export type WorkerState = "awaiting-answer" | "failed" | "stalled" | "working" | "queued" | "ended"

/** Most-demanding first. The top state names the chip and leads the sheet. */
export const WORKER_STATE_PRIORITY: readonly WorkerState[] = [
  "awaiting-answer",
  "failed",
  "stalled",
  "working",
  "queued",
  "ended",
] as const

export type WorkerStateCounts = Partial<Record<WorkerState, number>>

export interface WorkerStateSegment {
  state: WorkerState
  count: number
  label: string
}

function count(counts: WorkerStateCounts, state: WorkerState): number {
  const value = counts[state]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** "1 needs input" / "2 need input" — the only state whose noun is a verb. */
export function workerStateLabel(state: WorkerState, n: number): string {
  if (state === "awaiting-answer") return `${n} ${n === 1 ? "needs" : "need"} input`
  return `${n} ${state === "ended" ? "ended" : state}`
}

/**
 * How many workers are still the human's problem.
 *
 * `ended` is excluded: a job that left `jobs[]` is no longer running, and
 * counting it would make the chip claim work that may have finished minutes
 * ago (or never — absence is ambiguous).
 */
export function activeWorkerCount(counts: WorkerStateCounts): number {
  return WORKER_STATE_PRIORITY.filter((state) => state !== "ended").reduce((total, state) => total + count(counts, state), 0)
}

/**
 * The chip's words: the top state, plus at most one more.
 *
 * Two segments is the ceiling because the chip sits in a toolbar next to the
 * agent and model chips. The second segment exists for exactly one question —
 * "something needs me, but is anything still moving?" — so it is only ever
 * `working` or `queued`, and only when the top state is not already `working`.
 */
export function summarizeWorkerStates(counts: WorkerStateCounts): { segments: WorkerStateSegment[]; top: WorkerState } {
  const segment = (state: WorkerState): WorkerStateSegment => ({ state, count: count(counts, state), label: workerStateLabel(state, count(counts, state)) })
  const top = WORKER_STATE_PRIORITY.find((state) => count(counts, state) > 0)
  if (!top) return { segments: [], top: "ended" }

  const segments = [segment(top)]
  if (top !== "working" && count(counts, "working") + count(counts, "queued") > 0) {
    const second = (["working", "queued"] as const).find((state) => state !== top && count(counts, state) > 0)
    if (second) segments.push(segment(second))
  }
  return { segments, top }
}

/** The one string the chip, the row and its a11y label all read. */
export function workerStatesLabel(counts: WorkerStateCounts): string {
  return summarizeWorkerStates(counts).segments.map((s) => s.label).join(" · ")
}

/**
 * The chip fill, from the triage dot palette so a worker and a session row
 * agree on what red means. Foregrounds are the paired ones that clear 4.5:1
 * against their fill — see the contrast test.
 */
export function workerStateColors(state: WorkerState): { background: string; foreground: string } {
  switch (state) {
    case "awaiting-answer":
      return { background: DOT_NEEDS_ATTENTION, foreground: "#ffffff" }
    case "failed":
    case "stalled":
      return { background: DOT_RETRY, foreground: "#ffffff" }
    case "working":
      return { background: DOT_BUSY, foreground: "#0a0a0a" }
    case "queued":
      return { background: DOT_IDLE, foreground: "#0a0a0a" }
    case "ended":
      return { background: DOT_COMPLETE, foreground: "#0a0a0a" }
  }
}

/**
 * Per-job state, from the two typed sources that exist: the job is in `jobs[]`,
 * and `GET /question` has a pending entry for its `sessionID`.
 *
 * Nothing else is emitted. A job with no pending question is `working` — not
 * `stalled`, not `queued` — because the wire cannot distinguish those.
 */
export function deriveWorkerStates<T extends { sessionID: string }>({
  jobs,
  questionsBySession,
}: {
  jobs: readonly T[]
  questionsBySession: Record<string, readonly PendingQuestionLike[] | undefined>
}): Array<T & { state: WorkerState }> {
  return (jobs ?? []).map((job) => ({
    ...job,
    state: (questionsBySession?.[job.sessionID]?.length ? "awaiting-answer" : "working") as WorkerState,
  }))
}

/**
 * The states behind one session's worker chip.
 *
 * `running` stays authoritative for the count (#34): a settled session can
 * keep stale descriptors in `jobs[]`, and the list used to advertise workers
 * on a session the server had already reported as done. So the descriptors
 * name the states, but never the total: extra descriptors are dropped
 * highest-priority-first, and a remainder the server counts but does not
 * describe is `working` — the only state a bare count can justify.
 */
export function workerStatesFor<T extends { sessionID: string }>({
  running,
  jobs,
  questionsBySession,
}: {
  running: number
  jobs: readonly T[]
  questionsBySession: Record<string, readonly PendingQuestionLike[] | undefined>
}): { jobs: Array<T & { state: WorkerState }>; counts: WorkerStateCounts } {
  if (!(running > 0)) return { jobs: [], counts: {} }
  const described = deriveWorkerStates({ jobs, questionsBySession })
    .sort((a, b) => WORKER_STATE_PRIORITY.indexOf(a.state) - WORKER_STATE_PRIORITY.indexOf(b.state))
    .slice(0, running)
  const counts = countWorkerStates(described)
  const undescribed = running - described.length
  if (undescribed > 0) counts.working = (counts.working ?? 0) + undescribed
  return { jobs: described, counts }
}

export function countWorkerStates(jobs: readonly { state: WorkerState }[]): WorkerStateCounts {
  const counts: WorkerStateCounts = {}
  for (const job of jobs ?? []) counts[job.state] = (counts[job.state] ?? 0) + 1
  return counts
}

/** Group jobs by state, priority order, empty states omitted. */
export function workerStateSections<T extends { state: WorkerState }>(jobs: readonly T[]): Array<{ state: WorkerState; jobs: T[] }> {
  return WORKER_STATE_PRIORITY.flatMap((state) => {
    const matching = (jobs ?? []).filter((job) => job.state === state)
    return matching.length ? [{ state, jobs: matching }] : []
  })
}

export const ENDED_JOB_LIMIT = 5

/**
 * The last few jobs seen LEAVING the active set — client-observed only.
 *
 * A job's absence from `jobs[]` is ambiguous (it finished, OR the daemon
 * restarted, OR a decode failed), so this records departure and nothing else:
 * no success, no completion time, no server outcome.
 *
 * Returns `ended` unchanged when nothing left, so a caller can hold it in
 * state without re-rendering on every status event.
 */
export function trackEndedJobs<T extends { sessionID: string }>(
  previous: readonly T[],
  current: readonly T[],
  ended: readonly T[],
  limit = ENDED_JOB_LIMIT,
): readonly T[] {
  const live = new Set((current ?? []).map((job) => job.sessionID))
  const gone = (previous ?? []).filter((job) => !live.has(job.sessionID))
  const restarted = (ended ?? []).some((job) => live.has(job.sessionID))
  if (!gone.length && !restarted) return ended
  const goneIDs = new Set(gone.map((job) => job.sessionID))
  return [...gone, ...(ended ?? []).filter((job) => !goneIDs.has(job.sessionID) && !live.has(job.sessionID))].slice(0, limit)
}
