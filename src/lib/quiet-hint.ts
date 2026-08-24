/**
 * "Working…" that has gone silent is the stuck-vs-thinking question — seen
 * live: a server held a run open ("Working…") for 25 minutes after its last
 * message completed, with zero tools running. The client can't verify the
 * server's turn-state, but it CAN say how long the stream has been quiet,
 * which is exactly the evidence a human needs to decide whether to nudge.
 *
 * Suppressed while a tool is genuinely running: a long bash is legitimately
 * quiet on the text stream, and its card already shows a live elapsed clock.
 */

/** Quiet spells shorter than this are just a model thinking. */
export const QUIET_THRESHOLD_MS = 3 * 60_000

export function quietLabel(input: {
  /** Last text-delta timestamp for this session (previews harvest), if any. */
  lastTextAt: number | null | undefined
  /** A tool call in the live message is still running. */
  hasRunningTool: boolean
  now: number
}): string | null {
  if (input.hasRunningTool) return null
  if (!input.lastTextAt || !Number.isFinite(input.lastTextAt)) return null
  const quietMs = input.now - input.lastTextAt
  if (quietMs < QUIET_THRESHOLD_MS) return null
  const mins = Math.floor(quietMs / 60_000)
  if (mins < 60) return `quiet ${mins}m`
  return `quiet ${Math.floor(mins / 60)}h ${mins % 60}m`
}
