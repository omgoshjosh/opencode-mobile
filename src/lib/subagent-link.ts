// Turning a `task` tool call into a navigable child session.
//
// 133 of the 152 sessions in this workspace are children — subagents spawned
// by a `task` call, or swarm roles. The transcript rendered those calls as a
// description plus the prompt text and stopped there, so the actual work the
// subagent did was unreachable from the app even though it is a first-class
// session on the server.
//
// The link was already on the wire. A completed `task` part carries:
//
//     state.input    = { description, prompt, subagent_type, swarm_role, ... }
//     state.metadata = { sessionId, parentSessionId, model, runID }
//
// so `metadata.sessionId` is the child session, and the rest is enough to
// label it without a second request. Nothing here fetches — it reads a part
// that is already in the store, which is what keeps opening a subagent cheap.
//
// Pure, so the extraction rules are testable without a renderer.

import type { Part } from "./sdk"

export interface SubagentLink {
  /** The child session to navigate to. */
  sessionID: string
  /** Human label — the task's description, falling back to the tool title. */
  title: string
  /** e.g. "general", "explore". Absent for swarm-role tasks. */
  subagentType?: string
  /** e.g. "senior-engineer". Present when the task went to a swarm role. */
  swarmRole?: string
  /** The model that actually executed, which the swarm facade otherwise hides. */
  modelID?: string
  /** Mirrors the tool call: a running subagent is not yet browsable-complete. */
  status: "pending" | "running" | "completed" | "error"
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Extract the child-session link from a tool part, or null if there isn't one.
 *
 * Returns null rather than a partial link when `sessionId` is missing: a task
 * that failed before spawning, or an older server that predates the metadata,
 * has nothing to navigate to, and a card that looks tappable but goes nowhere
 * is worse than one that doesn't.
 */
export function subagentLinkFrom(part: Part | null | undefined): SubagentLink | null {
  if (!part || part.type !== "tool" || part.tool !== "task") return null

  const state = part.state
  if (!state) return null

  const metadata = record(state.metadata)
  const sessionID = str(metadata?.sessionId)
  if (!sessionID) return null

  const input = record(state.input)
  const title = str(input?.description) ?? str(state.title) ?? "Subagent"
  const model = record(metadata?.model)

  return {
    sessionID,
    title,
    subagentType: str(input?.subagent_type),
    swarmRole: str(input?.swarm_role),
    modelID: str(model?.modelID),
    status: state.status,
  }
}

/**
 * A completed task can have a child session even when its final report never
 * arrived. This deliberately considers only the terminal state and report
 * value; child metadata merely establishes that there is somewhere safe to
 * send the user for diagnostics.
 */
export function isCompletedSubagentReportMissing(part: Part | null | undefined): boolean {
  if (!subagentLinkFrom(part) || part?.state?.status !== "completed") return false
  return typeof part.state.output !== "string" || part.state.output.trim().length === 0
}

/**
 * Short badge text for a subagent card.
 *
 * Swarm role wins over subagent type: when a task is dispatched to a named
 * role, "senior-engineer" says more than the generic "general" that the swarm
 * path fills in for subagent_type.
 */
export function subagentBadge(link: SubagentLink): string | undefined {
  return link.swarmRole ?? link.subagentType
}

/**
 * Is the child session worth opening yet?
 *
 * A pending task has typically not created its session, and a running one is
 * mid-flight — that is still navigable and often the interesting case, since
 * it is how you watch a subagent work. Only "pending" is held back.
 */
export function isSubagentOpenable(link: SubagentLink): boolean {
  return link.status !== "pending"
}
