import { create } from "zustand"

/**
 * Ephemeral handoff for pushing large content onto a full screen.
 *
 * Route params are strings in the URL; a tool's output can be hundreds of
 * kilobytes, which does not belong in navigation state. The pushing screen
 * stages the content here and the viewer reads it — the same pattern as
 * passing nothing and re-deriving, except tool output is not re-derivable
 * from an id once the store's window has moved on.
 *
 * Deliberately not persisted anywhere; it exists only for the transition.
 */
interface ViewerState {
  toolOutput: {
    title: string
    input: string | null
    output: string
  } | null
  showToolOutput: (payload: { title: string; input: string | null; output: string }) => void
  clearToolOutput: () => void
}

export const useViewer = create<ViewerState>((set) => ({
  toolOutput: null,
  showToolOutput: (payload) => set({ toolOutput: payload }),
  clearToolOutput: () => set({ toolOutput: null }),
}))
