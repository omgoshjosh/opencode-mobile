import { create } from "zustand"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { parseDrafts, putDraft, type DraftMap } from "../lib/draft-store"

const DRAFTS_KEY = "opencode_drafts"

interface DraftsState {
  drafts: DraftMap
  loaded: boolean
  load: () => Promise<void>
  save: (sessionID: string, text: string) => void
  clear: (sessionID: string) => void
}

export const useDrafts = create<DraftsState>((set, get) => ({
  drafts: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const raw = await AsyncStorage.getItem(DRAFTS_KEY).catch(() => null)
    // loaded guards double-init; a save that raced the load wins over storage.
    set((state) => ({ loaded: true, drafts: { ...parseDrafts(raw), ...state.drafts } }))
  },

  save: (sessionID, text) => {
    const drafts = putDraft(get().drafts, sessionID, text, Date.now())
    set({ drafts })
    AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)).catch(() => {})
  },

  clear: (sessionID) => {
    get().save(sessionID, "")
  },
}))
