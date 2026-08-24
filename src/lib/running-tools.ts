/**
 * Farm-wide running-tool tracking, harvested from the global SSE stream.
 *
 * The stream already delivers every session's tool parts (the preview
 * harvest rides the same events); until now the client only LOOKED at the
 * open session's. Keeping a small live map of in-flight calls per session
 * is what turns "busy" into "busy running `gh pr checks`, 12m" — the
 * waiting-on panel and any future glance surface read from here.
 *
 * Bounded on every axis: tools per session, tracked sessions, and entries
 * expire when a completion/error arrives or the session goes idle.
 */

export interface RunningTool {
  partID: string
  messageID: string
  sessionID: string
  /** Human title at start time (tool-titles derivation, done by the caller). */
  title: string
  tool: string
  startedAt: number
}

export type RunningToolMap = Record<string, RunningTool[]>

export const MAX_TOOLS_PER_SESSION = 12
export const MAX_TRACKED_SESSIONS = 64

/** Upsert/remove based on a tool part's status transition. */
export function trackToolPart(
  map: RunningToolMap,
  part: {
    id?: string
    messageID?: string
    sessionID?: string
    tool?: string
    state?: { status?: string; time?: { start?: number } }
  },
  title: string,
  now: number,
): RunningToolMap {
  const sessionID = part.sessionID
  const partID = part.id
  if (!sessionID || !partID) return map
  const status = part.state?.status
  const existing = map[sessionID] ?? []

  if (status === "running" || status === "pending") {
    const entry: RunningTool = {
      partID,
      messageID: part.messageID ?? "",
      sessionID,
      title,
      tool: part.tool ?? "",
      startedAt: part.state?.time?.start ?? existing.find((t) => t.partID === partID)?.startedAt ?? now,
    }
    const next = [...existing.filter((t) => t.partID !== partID), entry].slice(-MAX_TOOLS_PER_SESSION)
    const result = { ...map, [sessionID]: next }
    return capSessions(result, sessionID)
  }

  // completed / error / anything else: the call is no longer in flight.
  if (existing.some((t) => t.partID === partID)) {
    const next = existing.filter((t) => t.partID !== partID)
    const result = { ...map }
    if (next.length === 0) delete result[sessionID]
    else result[sessionID] = next
    return result
  }
  return map
}

/** A session that reports idle has nothing in flight — clear stragglers
 *  (completions can be lost across reconnects; idle is authoritative). */
export function clearSessionTools(map: RunningToolMap, sessionID: string): RunningToolMap {
  if (!map[sessionID]) return map
  const result = { ...map }
  delete result[sessionID]
  return result
}

function capSessions(map: RunningToolMap, keepSessionID: string): RunningToolMap {
  const ids = Object.keys(map)
  if (ids.length <= MAX_TRACKED_SESSIONS) return map
  // Evict the session with the OLDEST newest-tool — least likely to matter.
  const evict = ids
    .filter((id) => id !== keepSessionID)
    .sort((a, b) => newestStart(map[a]) - newestStart(map[b]))[0]
  if (!evict) return map
  const result = { ...map }
  delete result[evict]
  return result
}

function newestStart(tools: RunningTool[]): number {
  return tools.reduce((max, t) => Math.max(max, t.startedAt), 0)
}

/**
 * Is this call plausibly waiting on CI / PR checks? Title-text heuristic,
 * deliberately dumb — it decorates, it never gates.
 */
export function looksLikeCIWait(title: string): boolean {
  return /\b(gh pr checks|pr checks|workflow|pipeline|\bci\b|checks)\b/i.test(title)
}
