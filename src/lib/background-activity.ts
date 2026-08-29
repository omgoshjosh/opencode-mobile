import type { Part, Session, SessionStatus } from "./sdk"
import { toolCallTitle } from "./tool-titles.ts"

export interface BackgroundJob {
  sessionID: string
  role: string
  title: string
  since: number
  status: "busy"
}

export type SessionStatusSnapshot = SessionStatus

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function taskFor(parts: Part[], sessionID: string): Part | undefined {
  return parts.find((part) => text(record(part.state?.metadata)?.sessionId) === sessionID)
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
    const jobs: BackgroundJob[] = modern.jobs.map((job) => ({ ...job, status: "busy" as const }))
    return { running: modern.running, jobs: jobs.sort(compareJobs) }
  }

  const jobs = sessions.flatMap((session) => {
    if (session.parentID !== parentID || statuses[session.id]?.type !== "busy" || terminalChildIDs[session.id]) return []
    const task = taskFor(parts, session.id)
    // A parent task completion/error closes its child immediately, even when
    // the child's busy event arrived late or its idle event was missed.
    if (task && (task.state?.status === "completed" || task.state?.status === "error")) return []
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

export function compareJobs(a: BackgroundJob, b: BackgroundJob): number {
  return a.since - b.since || a.sessionID.localeCompare(b.sessionID)
}

export function mergeStatusEvent(previous: SessionStatus | undefined, incoming: SessionStatus, _now?: number): SessionStatus {
  // Preserve only the aggregate when omitted; status variants own their fields.
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
    [...new Set([...Object.keys(snapshot), ...Object.keys(current)])].map((id) => {
      const latest = current[id]
      if (!latest || !touched.has(id)) return [id, snapshot[id] ?? latest]
      return [id, mergeStatusEvent(snapshot[id], latest, now)]
    }),
  )
}
