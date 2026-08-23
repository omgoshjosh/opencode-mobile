// Human-readable label for the composer's model chip.
//
// The chip used to render `modelID.split("/").pop()`, which is fine for a
// model id like "anthropic/claude-opus" but useless for a swarm, whose id is
// an opaque handle — the chip showed `swm_0043e3dd30010PKhr4pCJWdlMN` instead
// of "Fable Bowser Dev Team". The provider catalog already carries a display
// `name` for every model (including the synthetic `swarm` provider), and the
// model picker list already uses it; only the chip didn't.
//
// Resolution order:
//   1. the catalog's display name for that provider/model,
//   2. the last path segment of the id (previous behaviour, still right for
//      provider-prefixed ids and for models missing from the catalog),
//   3. "default" when nothing is selected — the server then picks.
//
// Dependency-free so it's testable under plain `node --test`.

import { SWARM_PROVIDER_ID } from "./swarm-model.ts"

export interface ModelRef {
  id: string
  name?: string
}

export interface ProviderRef {
  id: string
  models: ModelRef[]
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

export interface SwarmRef {
  id: string
  title?: string
}

export const DEFAULT_MODEL_LABEL = "default"

export function catalogModelName(
  providerID: string,
  model: ModelRef,
  swarms: SwarmRef[] | null | undefined,
): string {
  const swarmTitle =
    providerID === SWARM_PROVIDER_ID
      ? (swarms ?? []).find((swarm) => swarm.id === model.id)?.title?.trim()
      : undefined

  return swarmTitle || model.name?.trim() || model.id
}

export function modelDisplayLabel(
  providers: ProviderRef[] | null | undefined,
  selection: ModelSelection | null | undefined,
): string {
  if (!selection?.modelID) return DEFAULT_MODEL_LABEL

  const catalogName = (providers ?? [])
    .find((p) => p.id === selection.providerID)
    ?.models?.find((m) => m.id === selection.modelID)?.name

  if (catalogName && catalogName.trim()) return catalogName

  // Fallback: previous behaviour. Keeps working before the catalog loads and
  // for models the server didn't include.
  return selection.modelID.split("/").pop() || selection.modelID
}

/**
 * Re-title the synthetic swarm provider's models from fresh swarm metadata.
 *
 * Swarm titles are baked into catalog display names at load time, so a rename
 * in Settings left every other surface (composer chip, model picker, session
 * list headers) showing the old team name until the next full reload. This
 * patches just those names in place; providers, models, and the user's
 * selection are untouched. Identity is preserved when nothing changed so
 * callers can skip re-rendering.
 */
export function applySwarmTitles<
  P extends { id: string; models: Array<{ id: string; name: string }> },
>(providers: P[], swarms: SwarmRef[] | null | undefined): P[] {
  if (!swarms?.length) return providers
  let touched = false
  const next = providers.map((provider) => {
    if (provider.id !== SWARM_PROVIDER_ID) return provider
    let providerChanged = false
    const models = provider.models.map((model) => {
      const title = swarms.find((swarm) => swarm.id === model.id)?.title?.trim()
      if (!title || title === model.name) return model
      providerChanged = true
      return { ...model, name: title }
    })
    if (!providerChanged) return provider
    touched = true
    return { ...provider, models }
  })
  return touched ? next : providers
}
