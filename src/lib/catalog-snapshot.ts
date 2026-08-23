/**
 * Last-known provider/model catalog, for cold-start label hydration.
 *
 * The sessions list snapshot paints instantly, but every swarm badge and
 * group header resolves its display name through the catalog — which only
 * existed in memory. So a cold start on a slow backend showed rows titled by
 * their raw handles (`swm_0043e3…`) until the network landed: mapped data
 * presented as unmapped ids. The catalog is config metadata (provider names,
 * user-entered swarm team titles, capability flags) — exactly the kind of
 * thing the persisted-keys rule allows — so keep the last one on disk and
 * hydrate it alongside the session snapshot.
 *
 * Capability flags (reasoning/attachment/limit/variants) ride along so a
 * model selected before the live catalog lands keeps its real affordances —
 * hydrating names alone would briefly disable e.g. the attachment button.
 */

export interface SnapshotModel {
  id: string
  name?: string
  reasoning?: boolean
  attachment?: boolean
  limit?: { context: number; output: number }
  variants?: Record<string, { reasoningEffort?: string }>
}

export interface SnapshotProvider {
  id: string
  name?: string
  connected?: boolean
  models: SnapshotModel[]
}

/** Bounds keep a misbehaving server from growing the write without limit. */
export const SNAPSHOT_MAX_PROVIDERS = 50
export const SNAPSHOT_MAX_MODELS_PER_PROVIDER = 300

export function serializeCatalog(providers: SnapshotProvider[]): string {
  const trimmed = providers.slice(0, SNAPSHOT_MAX_PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    models: p.models.slice(0, SNAPSHOT_MAX_MODELS_PER_PROVIDER).map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      attachment: m.attachment,
      limit: m.limit,
      variants: m.variants,
    })),
  }))
  return JSON.stringify({ providers: trimmed })
}

/** Tolerant parse: corrupt/legacy snapshots degrade to null, never crash boot. */
export function parseCatalogSnapshot(raw: string | null | undefined): SnapshotProvider[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.providers)) return null
    const providers = parsed.providers.filter(
      (p: unknown): p is SnapshotProvider =>
        typeof (p as SnapshotProvider)?.id === "string" && Array.isArray((p as SnapshotProvider)?.models),
    )
    for (const provider of providers) {
      provider.models = provider.models.filter((m: SnapshotModel | null) => typeof m?.id === "string")
    }
    return providers.length > 0 ? providers : null
  } catch {
    return null
  }
}
