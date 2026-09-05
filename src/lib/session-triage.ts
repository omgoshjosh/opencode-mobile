// The visual vocabulary of the triage-first sessions list (V2 experiment).
//
// The classic list answered "which session needs me?" with four equal-weight
// chips per row; the redesign answers it with one status dot leading each
// row. This module is the single mapping from attention state to that dot,
// so the row component contains no state logic of its own.
//
// Design rules (from the list-redesign review):
// - Text labels only for states that DEMAND the user ("needs you" must not
//   depend on hue alone). Everything else is dot-only.
// - Motion (pulse) means "still moving" — running or retrying — so a stalled
//   run reads differently from a progressing one at a glance.
// - Idle is a hollow dot: the resting state should be barely-there.
//
// Pure, so the mapping is testable under plain `node --test`.

import type { Attention } from "./session-attention"

// The dot palette. Exported so the rows that render a dot and the styles that
// have to match one (the workers label sits next to the busy dot) read the
// same hex from here rather than re-typing it.
export const DOT_NEEDS_ATTENTION = "#dc2626"
export const DOT_RETRY = "#b45309"
export const DOT_BUSY = "#16a34a"
/** Was brand purple, which read as decoration; blue reads as "unread". */
export const DOT_COMPLETE = "#60a5fa"
export const DOT_IDLE = "#9a9a9a"

export interface TriageDot {
  color: string
  /** Animate: the session is actively doing something. */
  pulse: boolean
  /** Outline only — the barely-there resting state. */
  hollow: boolean
  /** Present only for states that demand the user. */
  label?: string
  /**
   * Always present. The dot is the row's whole status vocabulary, so a screen
   * reader needs a name for it even in the states that stay wordless on screen.
   */
  a11yLabel: string
}

/**
 * @param runningWorkers How many background workers this row's session is
 * running. A parent with running children is still working, so it must not
 * settle into "complete" (or "idle") just because the parent's own turn ended.
 * States that demand the user still outrank it: burying a pending permission
 * under a green dot is the regression session-attention.ts exists to prevent.
 */
export function triageDot(attention: Attention, runningWorkers = 0): TriageDot {
  const effective: Attention =
    runningWorkers > 0 && attention !== "needs-attention" && attention !== "retry" ? "busy" : attention
  switch (effective) {
    case "needs-attention":
      return { color: DOT_NEEDS_ATTENTION, pulse: false, hollow: false, label: "Needs you", a11yLabel: "Needs you" }
    case "retry":
      return { color: DOT_RETRY, pulse: true, hollow: false, label: "Retrying", a11yLabel: "Retrying" }
    case "busy":
      return { color: DOT_BUSY, pulse: true, hollow: false, a11yLabel: "Working" }
    case "complete":
      // Finished with output the user hasn't seen — worth a filled dot, not words.
      return { color: DOT_COMPLETE, pulse: false, hollow: false, a11yLabel: "Finished, unread" }
    case "idle":
      return { color: DOT_IDLE, pulse: false, hollow: true, a11yLabel: "Idle" }
  }
}

/**
 * The row's second line: who is doing the work, then what it last said.
 * Null when there is nothing to say — the row collapses to one line rather
 * than reserving blank space.
 */
export function rowSubtitle(swarmName: string | null | undefined, preview: string | null | undefined): string | null {
  const parts = [swarmName, preview].filter((part): part is string => Boolean(part && part.trim()))
  if (parts.length === 0) return null
  return parts.join(" · ")
}
