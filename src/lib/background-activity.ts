import type { Part, Session, SessionStatus } from "./sdk"
import { toolCallTitle } from "./tool-titles.ts"

export interface BackgroundJob {
  sessionID: string
  role: string
  title: string
  since: number
  status: "busy"
}

type SortableBackgroundJob = BackgroundJob & { owner: string; index: number }

export function backgroundJobRouteParams(job: BackgroundJob, sessions: Session[], parentDirectory?: string) {
  const sessionID = job?.sessionID ?? ""
  const directory = (sessions ?? []).find((session) => session?.id === sessionID)?.directory ?? parentDirectory
  return { id: sessionID, ...(directory ? { directory } : {}) }
}

export type SessionStatusSnapshot = SessionStatus

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function normalizeJob(value: unknown, index: number): SortableBackgroundJob {
  const job = record(value)
  const owner = text(job?.owner) ?? text(job?.sessionID) ?? text(job?.id) ?? ""
  return {
    sessionID: (text(job?.sessionID) ?? text(job?.id) ?? owner) || `background-job-${index + 1}`,
    role: text(job?.role) ?? "Background worker",
    title: text(job?.title) ?? "Background task",
    since: number(job?.since),
    status: "busy",
    owner,
    index,
  }
}

function sortedJobs(value: unknown): BackgroundJob[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeJob)
    .sort(compareJobs)
    .map(({ owner: _owner, index: _index, ...job }) => job)
}

function taskFor(parts: Part[], sessionID: string): Part | undefined {
  return parts.find((part) => part.type === "tool" && part.tool === "task" && text(record(part.state?.metadata)?.sessionId) === sessionID)
}

function taskIsTerminal(parts: Part[], sessionID: string): boolean {
  const task = taskFor(parts, sessionID)
  return task?.state?.status === "completed" || task?.state?.status === "error"
}

function taskTitle(part: Part): string {
  const input = record(part.state?.input)
  const stateTitle = text(part.state?.title)
  if (stateTitle && stateTitle.toLowerCase() !== "task") return stateTitle
  const swarmRole = text(input?.swarm_role)
  const role = swarmRole ?? text(input?.subagent_type) ?? text(input?.role)
  const { swarm_role: _swarmRole, subagent_type: _subagentType, description: _description, ...rest } = input ?? {}
  return toolCallTitle({
    ...part,
    state: { ...part.state, input: swarmRole ? { ...rest, role: swarmRole } : { ...input, subagent_type: role } },
  })
}

/**
 * The server reports `running` either as a count or as a boolean flag.
 *
 * A number is authoritative, including an explicit zero. A boolean only says
 * whether anything is running, so the job list supplies the count — and a
 * finished run can leave stale descriptors behind, which `false` must clear.
 */
function runningFrom(value: unknown, jobs: BackgroundJob[]): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "boolean") return value ? jobs.length : 0
  return jobs.length
}

/**
 * Has this connection been observed describing background jobs at all?
 *
 * The daemon (audited at a2ddc01, `SessionStatus`) never sends an empty
 * aggregate: `withBackground` attaches `background` only when a session has
 * live jobs and otherwise returns the status untouched. So "this parent has no
 * `background` key" cannot, on its own, be told apart from "this daemon has
 * never heard of `background`" — and the legacy busy-child heuristic below is
 * a guess we only want to make for the second case.
 *
 * Once ANY session on this connection has carried the key, the daemon
 * demonstrably speaks it, and its absence for a parent is a real zero.
 */
export function speaksBackground(statuses: Record<string, SessionStatusSnapshot>): boolean {
  return Object.values(statuses ?? {}).some((status) => !!status && "background" in status)
}

/** The server count is authoritative, including an explicit zero. */
export function backgroundFor({
  parentID,
  statuses,
  sessions,
  parts = [],
  terminalChildIDs = {},
}: {
  parentID: string
  statuses: Record<string, SessionStatusSnapshot>
  sessions: Session[]
  parts?: Part[]
  terminalChildIDs?: Record<string, true>
}): { running: number; jobs: BackgroundJob[] } | undefined {
  const modern = statuses[parentID]?.background
  if (modern) {
    const jobs = sortedJobs((modern as { jobs?: unknown }).jobs)
    return { running: runningFrom(modern.running, jobs), jobs }
  }
  // An authoritative zero must not fall through to guessing: on a daemon that
  // speaks `background`, an omitted aggregate means "nothing running", and the
  // legacy heuristic would happily resurrect it from one child whose cached
  // status never flipped to idle.
  if (speaksBackground(statuses)) return { running: 0, jobs: [] }

  const jobs = sessions.flatMap((session) => {
    if (session.parentID !== parentID || statuses[session.id]?.type !== "busy" || terminalChildIDs[session.id]) return []
    const task = taskFor(parts, session.id)
    // A parent task completion/error closes its child immediately, even when
    // the child's busy event arrived late or its idle event was missed.
    if (taskIsTerminal(parts, session.id)) return []
    const input = record(task?.state?.input)
    return [{
      sessionID: session.id,
      role: text(input?.swarm_role) ?? text(input?.subagent_type) ?? session.agent ?? "Agent",
      title: task ? taskTitle(task) : session.title || "Background task",
      since: task?.state?.time?.start ?? task?.time?.start ?? session.time.updated,
      status: "busy" as const,
    }]
  })
  return jobs.length ? { running: jobs.length, jobs: jobs.sort(compareJobs) } : undefined
}

/**
 * How many workers a session is running, by the same rule everywhere.
 *
 * The list used to read `background.jobs.length`, which is not the count: the
 * server's `running` is authoritative *including zero*, and a finished run can
 * leave its job descriptors behind, so a settled session kept advertising
 * workers. Detail already went through `backgroundFor`; this is the one
 * selector both screens share.
 */
export function runningWorkerCount(input: Parameters<typeof backgroundFor>[0]): number {
  return backgroundFor(input)?.running ?? 0
}

export function compareJobs(a: Partial<SortableBackgroundJob> | null | undefined, b: Partial<SortableBackgroundJob> | null | undefined): number {
  return number(a?.since) - number(b?.since)
    || String(a?.title ?? "").localeCompare(String(b?.title ?? ""))
    || String(a?.owner ?? a?.sessionID ?? "").localeCompare(String(b?.owner ?? b?.sessionID ?? ""))
    || number(a?.index) - number(b?.index)
}

/**
 * Fold one broadcast `session.status` into what we already knew.
 *
 * Preserve only the aggregate when omitted; status variants own their fields.
 * The carry-forward is deliberate and must stay: the daemon persists and
 * broadcasts the status with `background` stripped (`SessionStatus.write`
 * destructures it off before `events.commit`), and re-attaches it only in
 * `get`/`snapshot`. An event that omits `background` is therefore silence
 * about background work, not a zero — dropping the aggregate here would blank
 * the workers chip on the very next status tick. `mergeStatusSnapshot` below
 * owns the other half: a GET *is* a verdict.
 */
export function mergeStatusEvent(previous: SessionStatus | undefined, incoming: SessionStatus, _now?: number): SessionStatus {
  const background = "background" in incoming ? incoming.background : previous?.background
  return { ...incoming, ...(background !== undefined ? { background } : {}) }
}

export function mergeStatusSnapshot(
  current: Record<string, SessionStatus>,
  snapshot: Record<string, SessionStatus>,
  touched: Set<string>,
  now: number,
): Record<string, SessionStatus> {
  return Object.fromEntries(
    [...new Set([...Object.keys(current), ...Object.keys(snapshot)])].map((id) => {
      const latest = current[id]
      // Only an SSE event received while this GET was in flight can be newer
      // than the snapshot. A status omitted by the server is explicitly idle.
      // The touched branch still merges: the live event owns the variant, and
      // inherits the aggregate from the snapshot because events never carry one.
      if (latest && touched.has(id)) return [id, mergeStatusEvent(snapshot[id], latest, now)]
      // Otherwise the snapshot REPLACES what we held. A GET is the only
      // authoritative source of `background`, and it omits the key when a
      // session has no live jobs — so inheriting the previous aggregate here is
      // how a finished worker came back to life on every reopen and reconnect.
      return [id, snapshot[id] ?? { type: "idle" }]
    }),
  )
}
