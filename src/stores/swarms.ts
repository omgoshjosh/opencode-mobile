import { create } from "zustand"
import { useConnections } from "./connections"
import { useCatalog } from "./catalog"
import {
  applyPerRoleFallback,
  canSaveRoles,
  serverMessageFrom,
  toRoleInput,
  type RoleInput,
  type Swarm,
} from "../lib/swarm-crud"
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
      let saved: Swarm | null = null
      try {
        saved = swarmID
          ? await api.swarm.update(swarmID, { title, roles: payload })
          : await api.swarm.create({ title, roles: payload })
      } catch (err) {
        // A refusal WITH a server message is a validation failure the user
        // can fix (e.g. "first role must be the Orchestrator") — show the
        // server's words, not a capability verdict (found on Pixel 8 Pro:
        // every 400 was blamed on the server's contract).
        const serverMessage = serverMessageFrom(err)
        if (serverMessage) {
          set({ isSaving: false, error: serverMessage })
          return null
        }
        // A BARE refusal is the bulk-roles capability gap — server builds
        // with the per-role contract. Create has no honest fallback there:
        // those builds auto-seed a default team that no route can delete, so
        // "creating" would silently ship the wrong team. Say so and stop.
        if (!swarmID) {
          set({
            isSaving: false,
            error: "This server can't create swarm teams from the app yet",
          })
          return null
        }
        // Update CAN land via per-role writes; removals cannot (no DELETE
        // route), so applyPerRoleFallback reports what it had to leave behind.
        const outcome = await applyPerRoleFallback(
          {
            get: (id) => api.swarm.get(id),
            patchTitle: (id, t) => api.swarm.update(id, { title: t }),
            addRole: (id, r) => api.swarm.addRole(id, r),
            updateRole: (id, roleID, r) => api.swarm.updateRole(id, roleID, r),
          },
          swarmID,
          { title, roles: payload },
        )
        if (!outcome.ok) {
          set({
            isSaving: false,
            error:
              outcome.phase === "load"
                ? "Failed to load swarm before saving"
                : outcome.phase === "rename"
                  ? "Saved roles failed: couldn't rename the swarm"
                  : `Partially saved (${outcome.detail})`,
          })
          return null
        }
        // Refetch so the list reflects what the server actually holds — but
        // don't let a refresh failure turn a landed save into "failed".
        let refreshed: Swarm
        try {
          refreshed = await api.swarm.get(swarmID)
        } catch {
          void useCatalog.getState().refreshSwarms()
          set({
            isSaving: false,
            error: "Saved, but couldn't reload the swarm — pull to refresh",
          })
          return null
        }
        saved = refreshed
        const left =
          outcome.undeletable.length > 0
            ? ` — this server can't remove roles: ${outcome.undeletable.map((r) => r.name).join(", ")}`
            : ""
        if (left || outcome.added || outcome.updated) {
          set((state) => ({
            error: left ? `Saved${left}` : state.error,
          }))
        }
      }

      // Replace in place when it already existed so list order doesn't jump
      // under the user on a rename. The catalog bakes swarm titles into the
      // model picker / chips / session headers, so it must re-read them too —
      // otherwise the rename shows only here in Settings.
      void useCatalog.getState().refreshSwarms()
      set((state) => ({
        isSaving: false,
        swarms: state.swarms.some((s) => s.id === saved!.id)
          ? state.swarms.map((s) => (s.id === saved!.id ? saved! : s))
          : [saved!, ...state.swarms],
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
      // A deleted team must also leave the model picker and chips, not just
      // this list.
      void useCatalog.getState().refreshSwarms()
      set((state) => ({ swarms: state.swarms.filter((s) => s.id !== swarmID) }))
      return true
    } catch {
      set({ error: "Failed to delete swarm" })
      return false
    }
  },
}))
