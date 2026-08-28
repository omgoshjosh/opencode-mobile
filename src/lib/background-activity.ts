import type { Part, Session } from "./sdk"
import { toolCallTitle } from "./tool-titles.ts"

export interface BackgroundJob {
  sessionID: string
  role: string
  title: string
  since: number
  status: "busy"
}

export interface SessionStatusSnapshot {
  type: string
  background?: { running: number; jobs: Array<Omit<BackgroundJob, "status">> }
}

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
  return text(input?.description) ?? toolCallTitle(part)
}

/** The server count is authoritative, including an explicit zero. */
export function backgroundFor({
  parentID,
  statuses,
  sessions,
  parts = [],
}: {
  parentID: string
  statuses: Record<string, SessionStatusSnapshot>
  sessions: Session[]
  parts?: Part[]
}): { running: number; jobs: BackgroundJob[] } | undefined {
  const modern = statuses[parentID]?.background
  if (modern) {
    const jobs: BackgroundJob[] = modern.jobs.map((job) => ({ ...job, status: "busy" as const }))
    return { running: modern.running, jobs: jobs.sort(compareJobs) }
  }

  const jobs = sessions.flatMap((session) => {
    if (session.parentID !== parentID || statuses[session.id]?.type !== "busy") return []
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

export function runningChildren(parentID: string, statuses: Record<string, SessionStatusSnapshot>, sessions: Session[]): Session[] {
  return sessions
    .filter((session) => session.parentID === parentID && statuses[session.id]?.type === "busy")
    .sort((a, b) => a.time.updated - b.time.updated || a.id.localeCompare(b.id))
}
