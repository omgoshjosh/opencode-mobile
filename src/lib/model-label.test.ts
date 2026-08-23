import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applySwarmTitles,
  catalogModelName,
  DEFAULT_MODEL_LABEL,
  modelDisplayLabel,
  modelIDDisplayLabel,
  type ProviderRef,
  type SwarmRef,
} from "./model-label.ts"

const SWARM_ID = "swm_0043e3dd30010PKhr4pCJWdlMN"

const providers: ProviderRef[] = [
  {
    id: "swarm",
    models: [
      { id: SWARM_ID, name: "Fable Bowser Dev Team" },
      { id: "swm_ffefa457c001emtwoJaqlAMiB1", name: "OpenCodeX Reliability Team" },
    ],
  },
  { id: "openai", models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }] },
  { id: "bare", models: [{ id: "no-name-model" }] },
]

// The reported bug: the chip showed the opaque swarm handle.
test("a swarm shows its team name, not the raw id", () => {
  assert.equal(modelDisplayLabel(providers, { providerID: "swarm", modelID: SWARM_ID }), "Fable Bowser Dev Team")
})

test("swarm metadata replaces a raw provider-catalog name", () => {
  assert.equal(
    catalogModelName("swarm", { id: SWARM_ID, name: SWARM_ID }, [{ id: SWARM_ID, title: "Fable Bowser Dev Team" }]),
    "Fable Bowser Dev Team",
  )
})

test("catalog hydration preserves model and id fallbacks without swarm metadata", () => {
  assert.equal(catalogModelName("swarm", { id: SWARM_ID, name: "Catalog team name" }, []), "Catalog team name")
  assert.equal(catalogModelName("swarm", { id: SWARM_ID }, undefined), SWARM_ID)
  assert.equal(catalogModelName("openai", { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }, []), "GPT-5.6 Sol")
})

test("ordinary models show their catalog display name", () => {
  assert.equal(modelDisplayLabel(providers, { providerID: "openai", modelID: "gpt-5.6-sol" }), "GPT-5.6 Sol")
})

test("falls back to the last id segment when the catalog has no name", () => {
  assert.equal(modelDisplayLabel(providers, { providerID: "bare", modelID: "no-name-model" }), "no-name-model")
})

test("falls back for a model missing from the catalog entirely", () => {
  assert.equal(modelDisplayLabel(providers, { providerID: "openai", modelID: "unlisted" }), "unlisted")
  assert.equal(modelDisplayLabel(providers, { providerID: "nope", modelID: "anthropic/claude-opus" }), "claude-opus")
})

test("falls back before the catalog has loaded", () => {
  assert.equal(modelDisplayLabel([], { providerID: "swarm", modelID: SWARM_ID }), SWARM_ID)
  assert.equal(modelDisplayLabel(undefined, { providerID: "swarm", modelID: SWARM_ID }), SWARM_ID)
})

test("no selection means the server default", () => {
  assert.equal(modelDisplayLabel(providers, null), DEFAULT_MODEL_LABEL)
  assert.equal(modelDisplayLabel(providers, undefined), DEFAULT_MODEL_LABEL)
})

test("a whitespace-only catalog name does not blank the chip", () => {
  const odd: ProviderRef[] = [{ id: "p", models: [{ id: "m", name: "   " }] }]
  assert.equal(modelDisplayLabel(odd, { providerID: "p", modelID: "m" }), "m")
})

// --- applySwarmTitles: the rename-propagation fix ---

const RENAMED: SwarmRef[] = [
  { id: SWARM_ID, title: "Fable Bowser Dev Team v2" },
  { id: "swm_ffefa457c001emtwoJaqlAMiB1", title: "OpenCodeX Reliability Team" },
]

test("a swarm rename propagates into the catalog's display names", () => {
  const next = applySwarmTitles(providers, RENAMED)
  assert.equal(
    modelDisplayLabel(next, { providerID: "swarm", modelID: SWARM_ID }),
    "Fable Bowser Dev Team v2",
  )
})

test("only the swarm provider is touched and unchanged models keep identity", () => {
  const next = applySwarmTitles(providers, RENAMED)
  // untouched providers are the same object references
  assert.equal(next[1], providers[1])
  assert.equal(next[2], providers[2])
  // the renamed provider is a new object, the still-named model is not
  const swarmProvider = next.find((p) => p.id === "swarm")!
  assert.notEqual(swarmProvider, providers[0])
  const reliability = swarmProvider.models.find((m) => m.id === "swm_ffefa457c001emtwoJaqlAMiB1")!
  assert.equal(reliability, providers[0].models[1])
})

test("no changes means the same array comes back, so subscribers don't re-render", () => {
  const same: SwarmRef[] = [
    { id: SWARM_ID, title: "Fable Bowser Dev Team" },
    { id: "swm_ffefa457c001emtwoJaqlAMiB1", title: "OpenCodeX Reliability Team" },
  ]
  assert.equal(applySwarmTitles(providers, same), providers)
  assert.equal(applySwarmTitles(providers, []), providers)
  assert.equal(applySwarmTitles(providers, null), providers)
  assert.equal(applySwarmTitles(providers, undefined), providers)
})

test("a deleted team keeps its last catalog name rather than going blank", () => {
  const next = applySwarmTitles(providers, [{ id: SWARM_ID, title: "Fable Bowser Dev Team v2" }])
  const gone = next.find((p) => p.id === "swarm")!.models.find((m) => m.id === "swm_ffefa457c001emtwoJaqlAMiB1")!
  assert.equal(gone.name, "OpenCodeX Reliability Team")
})

test("whitespace-only titles never blank a label", () => {
  const odd = applySwarmTitles(providers, [{ id: SWARM_ID, title: "   " }])
  const model = odd.find((p) => p.id === "swarm")!.models.find((m) => m.id === SWARM_ID)!
  assert.equal(model.name, "Fable Bowser Dev Team")
})

test("modelIDDisplayLabel resolves a bare model id across providers", () => {
  const providers = [
    { id: "openai", models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }] },
    { id: "swarm", models: [{ id: "swm_abc", name: "Fable Bowser Dev Team" }] },
  ]
  assert.equal(modelIDDisplayLabel(providers, "swm_abc"), "Fable Bowser Dev Team")
  assert.equal(modelIDDisplayLabel(providers, "gpt-5.6-sol"), "GPT-5.6 Sol")
})

test("modelIDDisplayLabel falls back to the id's last segment before the catalog loads", () => {
  assert.equal(modelIDDisplayLabel([], "anthropic/claude-opus"), "claude-opus")
  assert.equal(modelIDDisplayLabel(null, "swm_abc"), "swm_abc")
})
