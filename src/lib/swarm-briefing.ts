// Collapsing the swarm briefing out of the transcript.
//
// When a session runs on a swarm, the server attaches the orchestrator's
// briefing — team roster, role instructions, delegation rules — to the user's
// message as its own text part:
//
//     <swarm-briefing swarm="Fable Bowser Dev Team">
//     ...several kilobytes of roster and rules...
//     </swarm-briefing>
//
// The transcript joined all text parts, so every message the user sent in a
// swarm session rendered with ~4.5KB of machinery bolted underneath it. The
// briefing is real context for the MODEL; for the human reading their own
// message back it is pure noise.
//
// Policy: the briefing is separated, not deleted. The bubble shows the user's
// own words plus a one-line indicator naming the swarm; the full text stays
// reachable behind a tap for the rare time it matters.
//
// Pure, so the splitting rules are testable under plain `node --test`.

const OPEN_TAG = /<swarm-briefing(?:\s+swarm="([^"]*)")?\s*>/
const CLOSE_TAG = "</swarm-briefing>"

export interface BriefingSplit {
  /** The message with the briefing removed. May be empty. */
  visibleText: string
  /** Full briefing body (tags stripped), for the expand affordance. */
  briefing: string | null
  /** The swarm's display name, from the tag attribute. */
  swarmName: string | null
}

/**
 * Split briefing from message text.
 *
 * Handles the briefing being its own part (the current server behaviour) and
 * being embedded before/after user text in one part (defensive — a transport
 * that joins parts first would produce exactly that). An unterminated tag is
 * treated as briefing-to-end rather than shown raw: half a roster is worse
 * than none.
 */
export function splitSwarmBriefing(text: string | null | undefined): BriefingSplit {
  const source = text ?? ""
  const match = OPEN_TAG.exec(source)
  if (!match) return { visibleText: source, briefing: null, swarmName: null }

  const start = match.index
  const bodyStart = start + match[0].length
  const closeAt = source.indexOf(CLOSE_TAG, bodyStart)
  const bodyEnd = closeAt === -1 ? source.length : closeAt
  const afterEnd = closeAt === -1 ? source.length : closeAt + CLOSE_TAG.length

  const briefing = source.slice(bodyStart, bodyEnd).trim()
  const visibleText = (source.slice(0, start) + source.slice(afterEnd)).trim()

  return {
    visibleText,
    briefing: briefing || null,
    swarmName: match[1]?.trim() || null,
  }
}

/** Does this text contain a briefing at all? Cheap pre-check for render paths. */
export function hasSwarmBriefing(text: string | null | undefined): boolean {
  return OPEN_TAG.test(text ?? "")
}
