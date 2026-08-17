import { test } from "node:test"
import assert from "node:assert/strict"
import { hasSwarmBriefing, splitSwarmBriefing } from "./swarm-briefing.ts"

const BRIEFING = `<swarm-briefing swarm="Fable Bowser Dev Team">
You are the orchestrator of the "Fable Bowser Dev Team" swarm.
Delegation rules:
- Delegate with the tool.
</swarm-briefing>`

test("plain text passes through untouched", () => {
  const got = splitSwarmBriefing("just a normal message")
  assert.equal(got.visibleText, "just a normal message")
  assert.equal(got.briefing, null)
  assert.equal(got.swarmName, null)
})

// The current server behaviour: the briefing is its own text part, so after
// parts are joined it follows the user's message.
test("a briefing after the user's message is separated", () => {
  const got = splitSwarmBriefing(`Fix the keyboard\n${BRIEFING}`)
  assert.equal(got.visibleText, "Fix the keyboard")
  assert.equal(got.swarmName, "Fable Bowser Dev Team")
  assert.match(got.briefing!, /orchestrator/)
  assert.equal(got.briefing!.includes("<swarm-briefing"), false)
})

test("a briefing before the message is separated too", () => {
  const got = splitSwarmBriefing(`${BRIEFING}\nFix the keyboard`)
  assert.equal(got.visibleText, "Fix the keyboard")
  assert.equal(got.swarmName, "Fable Bowser Dev Team")
})

test("a part that is only a briefing yields empty visible text", () => {
  const got = splitSwarmBriefing(BRIEFING)
  assert.equal(got.visibleText, "")
  assert.ok(got.briefing)
})

// Half a roster rendered raw is worse than none.
test("an unterminated briefing is treated as briefing to the end", () => {
  const got = splitSwarmBriefing('hello\n<swarm-briefing swarm="X">\nrules with no close tag')
  assert.equal(got.visibleText, "hello")
  assert.match(got.briefing!, /rules with no close tag/)
})

test("a tag without a swarm attribute still collapses", () => {
  const got = splitSwarmBriefing("<swarm-briefing>\nrules\n</swarm-briefing>\nmy text")
  assert.equal(got.visibleText, "my text")
  assert.equal(got.swarmName, null)
  assert.equal(got.briefing, "rules")
})

test("empty and null inputs are tolerated", () => {
  assert.equal(splitSwarmBriefing("").briefing, null)
  assert.equal(splitSwarmBriefing(null).visibleText, "")
  assert.equal(splitSwarmBriefing(undefined).briefing, null)
})

test("hasSwarmBriefing is a cheap accurate pre-check", () => {
  assert.equal(hasSwarmBriefing(BRIEFING), true)
  assert.equal(hasSwarmBriefing("no briefing here"), false)
  assert.equal(hasSwarmBriefing(null), false)
})

test("an empty briefing body collapses to nothing rather than an empty chip", () => {
  const got = splitSwarmBriefing('<swarm-briefing swarm="X"></swarm-briefing>hi')
  assert.equal(got.visibleText, "hi")
  assert.equal(got.briefing, null)
  // The name survives even when the body is empty — the indicator can still
  // say which swarm the message went to.
  assert.equal(got.swarmName, "X")
})
