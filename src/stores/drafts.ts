import { create } from "zustand"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { parseDrafts, putDraft, shouldWriteDraft, type DraftMap } from "../lib/draft-store"

const DRAFTS_KEY = "opencode_drafts"

interface DraftsState {
  drafts: DraftMap
  loaded: boolean
  load: () => Promise<void>
  save: (sessionID: string, text: string) => void
  clear: (sessionID: string) => void
  /** A deleted session's draft is garbage; drop it (#55). */
  prune: (sessionID: string) => void
}

// Sessions whose draft was written or cleared before hydration finished. Their
// in-memory state is fresher than storage, so hydration must not bring an old
// value (or a cleared one) back (#55).
const touchedBeforeLoad = new Set<string>()
let loading: Promise<void> | null = null

function persist(drafts: DraftMap) {
  AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)).catch(() => {})
}

export const useDrafts = create<DraftsState>((set, get) => ({
  drafts: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return
    loading ??= (async () => {
      const raw = await AsyncStorage.getItem(DRAFTS_KEY).catch(() => null)
      const stored = parseDrafts(raw)
      for (const id of touchedBeforeLoad) delete stored[id]
      // loaded guards double-init; a save (or clear) that raced the load wins over storage.
      set((state) => ({ loaded: true, drafts: { ...stored, ...state.drafts } }))
      const raced = touchedBeforeLoad.size > 0
      touchedBeforeLoad.clear()
      // Writes that raced hydration were held back (see save); land the merged map now.
      if (raced) persist(get().drafts)
    })().finally(() => {
      loading = null
    })
    return loading
  },

  save: (sessionID, text) => {
    const current = get().drafts
    // Keyboard dismissals and focus cleanups are frequent; unchanged text has
    // no reason to clone or serialize the complete bounded map.
    if (!get().loaded) {
      // Before hydration the in-memory map is not the whole story: writing it
      // would wipe every other session's stored draft. Hold the write until
      // load() merges, and remember that this session's value is the fresh one.
      touchedBeforeLoad.add(sessionID)
      set({ drafts: putDraft(current, sessionID, text, Date.now()) })
      void get().load()
      return
    }
    if (!shouldWriteDraft(current, sessionID, text)) return
    const drafts = putDraft(current, sessionID, text, Date.now())
    set({ drafts })
    persist(drafts)
  },

  clear: (sessionID) => {
    get().save(sessionID, "")
  },

  prune: (sessionID) => {
    get().clear(sessionID)
  },
}))
