import { create } from "zustand"
import { checkForUpdate, type AvailableUpdate } from "../lib/update-check"

/**
 * One shared answer to "is a newer build out?".
 *
 * Every surface used to run its own checkForUpdate on mount, so the answer
 * only existed on screens that had asked — the Settings tab icon could not
 * carry a badge for an update discovered by the sessions-list banner. This
 * store is refreshed on launch and on every app foreground (see _layout.tsx);
 * the 24h network throttle and the cached last answer both live in
 * update-check-policy.ts, so foreground refreshes are storage reads, not
 * network beacons.
 *
 * ignoreDismissed: the badge and the Settings row are ambient signals, not
 * interruptions — "not now" on the banner means stop interrupting, not
 * "hide that I'm out of date everywhere". The banner keeps applying the
 * dismissal itself.
 */
interface UpdateState {
  available: AvailableUpdate | null
  refresh: () => Promise<void>
}

export const useUpdate = create<UpdateState>((set) => ({
  available: null,
  refresh: async () => {
    try {
      set({ available: await checkForUpdate({ ignoreDismissed: true }) })
    } catch {
      // A broken update check must never be visible.
    }
  },
}))
