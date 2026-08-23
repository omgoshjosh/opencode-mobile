import { test } from "node:test"
import assert from "node:assert/strict"
import {
  serializeCatalog,
  parseCatalogSnapshot,
  SNAPSHOT_MAX_PROVIDERS,
  SNAPSHOT_MAX_MODELS_PER_PROVIDER,
} from "./catalog-snapshot.ts"

test("round-trip preserves names and capability flags", () => {
  const providers = [
    {
      id: "swarm",
      name: "Swarms",
      connected: true,
      models: [
        { id: "swm_1", name: "Fable Bowser Dev Team", attachment: true, variants: { low: { reasoningEffort: "low" } } },
      ],
    },
  ]
  const parsed = parseCatalogSnapshot(serializeCatalog(providers))
  assert.equal(parsed?.[0].models[0].name, "Fable Bowser Dev Team")
  assert.equal(parsed?.[0].models[0].attachment, true)
  assert.deepEqual(parsed?.[0].models[0].variants, { low: { reasoningEffort: "low" } })
})

test("bounded in both dimensions", () => {
  const providers = Array.from({ length: SNAPSHOT_MAX_PROVIDERS + 5 }, (_, i) => ({
    id: `p${i}`,
    models: Array.from({ length: SNAPSHOT_MAX_MODELS_PER_PROVIDER + 5 }, (_, j) => ({ id: `m${j}` })),
  }))
  const parsed = parseCatalogSnapshot(serializeCatalog(providers))
  assert.equal(parsed?.length, SNAPSHOT_MAX_PROVIDERS)
  assert.equal(parsed?.[0].models.length, SNAPSHOT_MAX_MODELS_PER_PROVIDER)
})

test("corrupt snapshots degrade to null, never throw", () => {
  assert.equal(parseCatalogSnapshot(null), null)
  assert.equal(parseCatalogSnapshot("{bad"), null)
  assert.equal(parseCatalogSnapshot(JSON.stringify({ providers: "nope" })), null)
  assert.equal(parseCatalogSnapshot(JSON.stringify({ providers: [] })), null)
})

test("malformed entries are dropped, valid ones kept", () => {
  const raw = JSON.stringify({
    providers: [{ id: "ok", models: [{ id: "m1" }, { name: "no-id" }, null] }, { models: [] }, 42],
  })
  const parsed = parseCatalogSnapshot(raw)
  assert.equal(parsed?.length, 1)
  assert.deepEqual(parsed?.[0].models.map((m) => m.id), ["m1"])
})
