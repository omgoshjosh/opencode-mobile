// Ordering the session list.
//
// The list always sorted newest-first — right for supervision, wrong for
// "find that session from Tuesday whose name I remember". Sorting is a
// separate axis from filtering (which narrows) and grouping (which
// organises): all three compose.
//
// Ties in the name sorts break by recency (newest first) so identically
// titled sessions — a bot farm speciality — keep a stable, useful order.
//
// Pure, so the comparators are testable under plain `node --test`.

export type SessionSort = "newest" | "oldest" | "name-asc" | "name-desc"

export const SESSION_SORTS: { value: SessionSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
]

export function parseSessionSort(value: unknown): SessionSort {
  return value === "oldest" || value === "name-asc" || value === "name-desc" ? value : "newest"
}

interface Sortable {
  title?: string
  time?: { updated?: number }
}

export function sortSessions<T extends Sortable>(sessions: T[], sort: SessionSort): T[] {
  const updated = (s: Sortable) => s.time?.updated ?? 0
  // Untitled sessions sink to the end in BOTH name directions — reversing a
  // name sort should reverse the names, not surface the nameless.
  const name = (s: Sortable) => (s.title ?? "").trim().toLowerCase()
  const out = sessions.slice()
  switch (sort) {
    case "newest":
      return out.sort((a, b) => updated(b) - updated(a))
    case "oldest":
      return out.sort((a, b) => updated(a) - updated(b))
    case "name-asc":
    case "name-desc": {
      const direction = sort === "name-asc" ? 1 : -1
      return out.sort((a, b) => {
        const an = name(a)
        const bn = name(b)
        if (!an && !bn) return updated(b) - updated(a)
        if (!an) return 1
        if (!bn) return -1
        const byName = an.localeCompare(bn)
        if (byName !== 0) return byName * direction
        return updated(b) - updated(a)
      })
    }
  }
}
