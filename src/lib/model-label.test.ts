import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_MODEL_LABEL, modelDisplayLabel, type ProviderRef } from "./model-label.ts"

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
