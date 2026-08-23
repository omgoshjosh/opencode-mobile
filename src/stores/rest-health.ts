import { create } from "zustand"
import { setLatencyReporter } from "../lib/sdk"
import { recordSample, isRestSlow, type LatencySample } from "../lib/rest-latency"

/**
 * REST-path health, distinct from SSE liveness (src/stores/events.ts): a
 * healthy event stream with a slow request path used to look identical to
 * all-green. The classifier itself is pure (src/lib/rest-latency.ts); this
 * store just feeds it samples from the SDK and exposes the verdict.
 *
 * `slow` is re-evaluated only when a sample arrives — between requests the
 * verdict shows the last observed state, which is the honest claim ("the
 * server WAS slow moments ago"), and any user action produces fresh evidence
 * immediately.
 */
interface RestHealthState {
  samples: LatencySample[]
  slow: boolean
  report: (ms: number) => void
}

export const useRestHealth = create<RestHealthState>((set, get) => ({
  samples: [],
  slow: false,
  report: (ms) => {
    const now = Date.now()
    const samples = recordSample(get().samples, ms, now)
    set({ samples, slow: isRestSlow(samples, now) })
  },
}))

setLatencyReporter((ms) => useRestHealth.getState().report(ms))
