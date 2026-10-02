// The session list's worker chip, as one pure selector (#53).
//
// Both list row variants read this, so the chip's rule lives in one testable
// place instead of inside a React hook.
//
// A root's workers are the union, by session id, of two kinds of evidence:
//
//   1. The root's own `background` aggregate (daemon `SessionStatus.get` /
//      `snapshot`). It only ever describes `background: true` delegations
//      whose direct parent is this root, and since daemon 38d00c5 its `jobs`
//      also carry `blocked` and finished-but-undelivered `completed` entries.
//      `completed` is not work and is never counted.
//   2. Every session with a working status that descends from the root, at any
//      depth, through the parent index. This is what swarm roles, foreground
//      subagents and nested workers look like: none of them produce an
//      aggregate on the root, and the list does not hold them as rows.
//
// #53 was the second kind going uncounted: the list held roots only, the
// busy-children fallback looked at direct children in that roots-only list,
// and one aggregate anywhere on the connection switched the fallback off for
// every row.

import type { Session, SessionStatus } from "./sdk"
import type { PendingQuestionLike } from "./question-hydration"
import { descendsFrom, isWorkingStatus, parentLinks, type ParentIndex } from "./session-ancestry.ts"
import { activeWorkerCount, summarizeWorkerStates, workerStatesFor, workerStatesLabel, type WorkerState } from "./worker-states.ts"

export interface ListWorkerSummaryInput {
  rootID: string
  statuses: Record<string, SessionStatus>
  sessions: Session[]
  /** Parent links learned outside the row list (tree children, events, lookups). */
  parents?: ParentIndex
  terminalChildIDs?: Record<string, true>
  questionsBySession?: Record<string, readonly PendingQuestionLike[] | undefined>
}

export interface ListWorkerSummary {
  count: number
  label: string
  top: WorkerState
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** Session ids the root's own aggregate vouches for, plus any count it does not describe. */
function aggregateWorkers(background: unknown): { ids: string[]; undescribed: number } {
  const aggregate = record(background)
  if (!aggregate) return { ids: [], undescribed: 0 }
  const jobs = (Array.isArray(aggregate.jobs) ? aggregate.jobs : []).flatMap((value) => {
    const job = record(value)
    const id = typeof job?.sessionID === "string" ? job.sessionID : typeof job?.id === "string" ? job.id : undefined
    return id ? [{ id, status: job?.status }] : []
  })
  const running = aggregate.running
  // Legacy numeric contract: the count is authoritative, including zero.
  if (typeof running === "number" && Number.isFinite(running)) {
    const ids = jobs.filter((job) => job.status !== "completed").slice(0, Math.max(0, running)).map((job) => job.id)
    return { ids, undescribed: Math.max(0, running - ids.length) }
  }
  // Boolean contract: `running` says whether any job is working. `blocked`
  // jobs are outstanding either way (parked on a human); `completed` never is.
  const outstanding = jobs.filter((job) => (running === false ? job.status === "blocked" : job.status !== "completed"))
  return { ids: outstanding.map((job) => job.id), undescribed: 0 }
}

export function listWorkerSummary({
  rootID,
  statuses,
  sessions,
  parents = {},
  terminalChildIDs = {},
  questionsBySession = {},
}: ListWorkerSummaryInput): ListWorkerSummary {
  const index: ParentIndex = { ...parents, ...parentLinks(sessions) }
  const aggregate = aggregateWorkers(statuses?.[rootID]?.background)
  const ids = new Set(aggregate.ids)
  for (const [id, status] of Object.entries(statuses ?? {})) {
    if (!isWorkingStatus(status) || terminalChildIDs[id]) continue
    if (descendsFrom(id, rootID, index)) ids.add(id)
  }
  const jobs = [...ids].map((sessionID) => ({ sessionID }))
  const { counts } = workerStatesFor({ running: jobs.length + aggregate.undescribed, jobs, questionsBySession })
  return { count: activeWorkerCount(counts), label: workerStatesLabel(counts), top: summarizeWorkerStates(counts).top }
}
