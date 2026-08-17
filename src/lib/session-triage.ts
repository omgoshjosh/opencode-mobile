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

export interface TriageDot {
  color: string
  /** Animate: the session is actively doing something. */
  pulse: boolean
  /** Outline only — the barely-there resting state. */
  hollow: boolean
  /** Present only for states that demand the user. */
  label?: string
}

export function triageDot(attention: Attention): TriageDot {
  switch (attention) {
    case "needs-attention":
      return { color: "#dc2626", pulse: false, hollow: false, label: "Needs you" }
    case "retry":
      return { color: "#b45309", pulse: true, hollow: false, label: "Retrying" }
    case "busy":
      return { color: "#16a34a", pulse: true, hollow: false }
    case "complete":
      // Finished with output the user hasn't seen — worth a filled dot, not words.
      return { color: "#8b5cf6", pulse: false, hollow: false }
    case "idle":
      return { color: "#9a9a9a", pulse: false, hollow: true }
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
