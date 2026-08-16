// "Where am I in the subagent stack?"
//
// Opening a subagent pushes its session onto the navigation stack, so the OS
// back gesture already returns you to the parent. What it does not tell you is
// that you are *in* a child at all — a subagent session looks exactly like a
// top-level one, with its own title and transcript.
//
// This produces the label for a breadcrumb bar shown only on child sessions.
// It is deliberately tolerant: the parent may not be in the loaded session
// list (the list is capped, and a child can be opened directly from a deep
// link), and an unnamed parent is still worth pointing at.

import type { Session } from "./sdk"

export interface Breadcrumb {
  parentID: string
  /** The parent's title, or a neutral stand-in when it isn't loaded. */
  label: string
  /** True when the label is a stand-in rather than the real title. */
  resolved: boolean
}

const FALLBACK_LABEL = "parent session"

/**
 * Breadcrumb for `session`, or null when it is a root.
 *
 * `sessions` is whatever the list store happens to hold; a miss degrades to an
 * unresolved breadcrumb rather than hiding the affordance, because the
 * navigation still works — only the name is unknown.
 */
export function breadcrumbFor(
  session: Pick<Session, "parentID"> | null | undefined,
  sessions: Array<Pick<Session, "id" | "title">> | null | undefined,
): Breadcrumb | null {
  const parentID = session?.parentID?.trim()
  if (!parentID) return null

  const parent = (sessions ?? []).find((s) => s.id === parentID)
  const title = parent?.title?.trim()
  return title
    ? { parentID, label: title, resolved: true }
    : { parentID, label: FALLBACK_LABEL, resolved: false }
}
