import { create } from "zustand"
import { useConnections } from "./connections"
import { canSaveRoles, toRoleInput, type RoleInput, type Swarm } from "../lib/swarm-crud"
import type { SkillInfo } from "../lib/sdk"

interface SwarmsState {
  swarms: Swarm[]
  skills: SkillInfo[]
  isLoading: boolean
  isSaving: boolean
  error: string | null

  load: () => Promise<void>
  loadSkills: () => Promise<void>
  /** Create when `swarmID` is absent, otherwise update in place. */
  save: (input: { swarmID?: string; title: string; roles: RoleInput[] }) => Promise<Swarm | null>
  remove: (swarmID: string) => Promise<boolean>
  clearError: () => void
}

// Swarm management is server-wide rather than directory-scoped, so it uses the
// directory-less client — the same reasoning as the global session list.
function client() {
  const state = useConnections.getState()
  return state.clientForDirectory(undefined) || state.client
}

export const useSwarms = create<SwarmsState>((set, get) => ({
  swarms: [],
  skills: [],
  isLoading: false,
  isSaving: false,
  error: null,

  clearError: () => set({ error: null }),

  load: async () => {
    const api = client()
    if (!api) {
      set({ error: "No active connection" })
      return
    }
    try {
      set({ isLoading: true, error: null })
      set({ swarms: await api.swarm.list(), isLoading: false })
    } catch {
      set({ error: "Failed to load swarms", isLoading: false })
    }
  },

  loadSkills: async () => {
    const api = client()
    if (!api) return
    try {
      set({ skills: await api.skill.list() })
    } catch {
      // The skill picker is a convenience for seeding roles; losing it must
      // not block editing a swarm by hand.
    }
  },

  save: async ({ swarmID, title, roles }) => {
    const api = client()
    if (!api) {
      set({ error: "No active connection" })
      return null
    }

    // PATCH replaces the role set wholesale, so saving an empty array deletes
    // every role on the server. Refuse rather than let a half-loaded editor
    // turn a rename into a wipe. See src/lib/swarm-crud.ts.
    if (!canSaveRoles(roles)) {
      set({ error: "A swarm needs at least one role" })
      return null
    }

    const payload = roles.map(toRoleInput)
    try {
      set({ isSaving: true, error: null })
      const saved = swarmID
        ? await api.swarm.update(swarmID, { title, roles: payload })
        : await api.swarm.create({ title, roles: payload })

      // Replace in place when it already existed so list order doesn't jump
      // under the user on a rename.
      set((state) => ({
        isSaving: false,
        swarms: state.swarms.some((s) => s.id === saved.id)
          ? state.swarms.map((s) => (s.id === saved.id ? saved : s))
          : [saved, ...state.swarms],
      }))
      return saved
    } catch {
      set({ error: swarmID ? "Failed to save swarm" : "Failed to create swarm", isSaving: false })
      return null
    }
  },

  remove: async (swarmID) => {
    const api = client()
    if (!api) {
      set({ error: "No active connection" })
      return false
    }
    try {
      await api.swarm.delete(swarmID)
      set((state) => ({ swarms: state.swarms.filter((s) => s.id !== swarmID) }))
      return true
    } catch {
      set({ error: "Failed to delete swarm" })
      return false
    }
  },
}))
