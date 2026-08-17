import { test } from "node:test"
import assert from "node:assert/strict"
import { compactNumber, sessionStats } from "./session-stats.ts"
import type { Message } from "./sdk.ts"

function user(id: string): Message {
  return { id, sessionID: "s", role: "user", time: { created: 1 } }
}

function assistant(id: string, extra: Partial<Message> = {}): Message {
  return { id, sessionID: "s", role: "assistant", time: { created: 1 }, ...extra }
}

test("an empty transcript yields zeroes, not NaN", () => {
  const stats = sessionStats([])
  assert.equal(stats.cost, 0)
  assert.equal(stats.inputTokens, 0)
  assert.deepEqual(stats.models, [])
  assert.equal(sessionStats(null).userMessages, 0)
})

test("costs and tokens sum across assistant messages", () => {
  const stats = sessionStats([
    user("u1"),
    assistant("a1", { cost: 0.5, tokens: { input: 100, output: 20, cache: { read: 1000, write: 0 } } }),
    assistant("a2", { cost: 0.25, tokens: { input: 50, output: 10 } }),
  ])
  assert.equal(stats.cost, 0.75)
  assert.equal(stats.inputTokens, 150)
  assert.equal(stats.outputTokens, 30)
  assert.equal(stats.cacheReadTokens, 1000)
  assert.equal(stats.userMessages, 1)
  assert.equal(stats.assistantMessages, 2)
})

// Assistant messages carry the real execution model, so a swarm session lists
// what actually ran rather than the facade.
test("models are distinct, in first-use order", () => {
  const stats = sessionStats([
    assistant("a1", { modelID: "opus" }),
    assistant("a2", { modelID: "sonnet" }),
    assistant("a3", { modelID: "opus" }),
  ])
  assert.deepEqual(stats.models, ["opus", "sonnet"])
})

test("messages missing cost or tokens are tolerated", () => {
  const stats = sessionStats([assistant("a1"), assistant("a2", { cost: 1 })])
  assert.equal(stats.cost, 1)
  assert.equal(stats.inputTokens, 0)
})

test("compactNumber keeps small numbers exact and big ones readable", () => {
  assert.equal(compactNumber(812), "812")
  assert.equal(compactNumber(45_300), "45.3k")
  assert.equal(compactNumber(1_200_000), "1.2M")
  assert.equal(compactNumber(0), "0")
})
