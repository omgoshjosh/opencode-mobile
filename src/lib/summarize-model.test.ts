import { test } from "node:test"
import assert from "node:assert/strict"
import { summarizeModel } from "./summarize-model.ts"

test("the last assistant's real execution model wins", () => {
  const messages = [
    { role: "user" },
    { role: "assistant", providerID: "openai", modelID: "gpt-5.6-sol" },
    { role: "assistant", providerID: "anthropic", modelID: "fable" },
    { role: "user" },
  ]
  assert.deepEqual(summarizeModel(messages, null), { providerID: "anthropic", modelID: "fable" })
})

test("the swarm facade is never chosen — neither from messages nor fallback", () => {
  const messages = [{ role: "assistant", providerID: "swarm", modelID: "swm_x" }]
  assert.equal(summarizeModel(messages, { providerID: "swarm", modelID: "swm_x" }), null)
})

test("empty transcript uses the fallback", () => {
  assert.deepEqual(summarizeModel([], { providerID: "openai", modelID: "gpt-5.6-luna" }), {
    providerID: "openai",
    modelID: "gpt-5.6-luna",
  })
  assert.equal(summarizeModel([], null), null)
})
