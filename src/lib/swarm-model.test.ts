import { test } from "node:test"
import assert from "node:assert/strict"
import {
  SWARM_PROVIDER_ID,
  isSwarmSelection,
  resolveSessionModel,
  sessionModelSelection,
} from "./swarm-model.ts"

const SWARM_ID = "swm_0043e3dd30010PKhr4pCJWdlMN"
const swarmSession = { providerID: SWARM_PROVIDER_ID, id: SWARM_ID }
const sol = { providerID: "openai", modelID: "gpt-5.6-sol" }
const terra = { providerID: "openai", modelID: "gpt-5.6-terra" }

test("isSwarmSelection distinguishes the synthetic swarm provider", () => {
  assert.equal(isSwarmSelection({ providerID: SWARM_PROVIDER_ID, modelID: SWARM_ID }), true)
  assert.equal(isSwarmSelection(sol), false)
  assert.equal(isSwarmSelection(null), false)
  assert.equal(isSwarmSelection(undefined), false)
})

test("sessionModelSelection maps the server's `id` onto the store's `modelID`", () => {
  assert.deepEqual(sessionModelSelection(swarmSession), {
    providerID: SWARM_PROVIDER_ID,
    modelID: SWARM_ID,
  })
  assert.deepEqual(sessionModelSelection({ providerID: "claude-code", id: "opus" }), {
    providerID: "claude-code",
    modelID: "opus",
  })
})

test("sessionModelSelection tolerates missing/partial session models", () => {
  assert.equal(sessionModelSelection(null), null)
  assert.equal(sessionModelSelection(undefined), null)
  assert.equal(sessionModelSelection({ providerID: "openai" } as never), null)
  assert.equal(sessionModelSelection({ id: "gpt-5.6-sol" } as never), null)
})

// The regression this module exists for.
test("a swarm session is NOT overwritten by the assistant's resolved execution model", () => {
  assert.deepEqual(resolveSessionModel({ sessionModel: swarmSession, fromMessages: sol }), {
    providerID: SWARM_PROVIDER_ID,
    modelID: SWARM_ID,
  })
})

test("the swarm survives a Terra-backed reply too", () => {
  assert.deepEqual(resolveSessionModel({ sessionModel: swarmSession, fromMessages: terra }), {
    providerID: SWARM_PROVIDER_ID,
    modelID: SWARM_ID,
  })
})

test("a swarm session restores on cold open / reload with no messages yet", () => {
  assert.deepEqual(resolveSessionModel({ sessionModel: swarmSession, fromMessages: null }), {
    providerID: SWARM_PROVIDER_ID,
    modelID: SWARM_ID,
  })
})

test("ordinary sessions still follow the conversation's model", () => {
  assert.deepEqual(
    resolveSessionModel({ sessionModel: { providerID: "claude-code", id: "opus" }, fromMessages: sol }),
    sol,
  )
})

test("ordinary sessions fall back to the persisted model when messages have none", () => {
  assert.deepEqual(resolveSessionModel({ sessionModel: { providerID: "claude-code", id: "opus" }, fromMessages: null }), {
    providerID: "claude-code",
    modelID: "opus",
  })
})

test("returns null when there is nothing to apply, so the caller leaves selection alone", () => {
  assert.equal(resolveSessionModel({ sessionModel: null, fromMessages: null }), null)
  assert.equal(resolveSessionModel({}), null)
})

test("deliberately switching a swarm session to an ordinary model is not blocked here", () => {
  // Selecting an ordinary model re-persists session.model server-side; once it
  // is no longer a swarm, normal message-derived syncing resumes.
  assert.deepEqual(resolveSessionModel({ sessionModel: { providerID: "openai", id: "gpt-5.6-sol" }, fromMessages: sol }), sol)
})
