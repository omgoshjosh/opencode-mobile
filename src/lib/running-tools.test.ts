import { test } from "node:test"
import assert from "node:assert/strict"
import {
  trackToolPart,
  clearSessionTools,
  looksLikeCIWait,
  MAX_TOOLS_PER_SESSION,
  MAX_TRACKED_SESSIONS,
  type RunningToolMap,
} from "./running-tools.ts"

const part = (sessionID: string, partID: string, status: string, start?: number) => ({
  id: partID,
  messageID: "m1",
  sessionID,
  tool: "bash",
  state: { status, time: { start } },
})

test("running parts are tracked with their start time; completion removes them", () => {
  let map: RunningToolMap = {}
  map = trackToolPart(map, part("s1", "p1", "running", 100), "gh pr checks 42", 999)
  assert.equal(map.s1[0].title, "gh pr checks 42")
  assert.equal(map.s1[0].startedAt, 100)
  map = trackToolPart(map, part("s1", "p1", "completed"), "gh pr checks 42", 999)
  assert.equal(map.s1, undefined)
})

test("re-running updates preserve the original start when the part omits it", () => {
  let map: RunningToolMap = {}
  map = trackToolPart(map, part("s1", "p1", "running", 100), "npm test", 999)
  map = trackToolPart(map, { ...part("s1", "p1", "running"), state: { status: "running", time: {} } }, "npm test", 2000)
  assert.equal(map.s1[0].startedAt, 100)
})

test("completions for untracked parts are no-ops (identity preserved)", () => {
  const map: RunningToolMap = {}
  assert.equal(trackToolPart(map, part("s1", "p9", "completed"), "x", 1), map)
})

test("per-session tool list is bounded", () => {
  let map: RunningToolMap = {}
  for (let i = 0; i < MAX_TOOLS_PER_SESSION + 5; i++) {
    map = trackToolPart(map, part("s1", `p${i}`, "running", i), `t${i}`, 999)
  }
  assert.equal(map.s1.length, MAX_TOOLS_PER_SESSION)
})

test("tracked-session count is bounded by evicting the stalest", () => {
  let map: RunningToolMap = {}
  for (let i = 0; i < MAX_TRACKED_SESSIONS + 1; i++) {
    map = trackToolPart(map, part(`s${i}`, "p1", "running", i), "t", 999)
  }
  assert.equal(Object.keys(map).length, MAX_TRACKED_SESSIONS)
  assert.equal(map.s0, undefined) // oldest evicted
})

test("idle clears a session's stragglers", () => {
  let map: RunningToolMap = {}
  map = trackToolPart(map, part("s1", "p1", "running", 1), "t", 999)
  map = clearSessionTools(map, "s1")
  assert.equal(map.s1, undefined)
  assert.equal(clearSessionTools(map, "s1"), map) // no-op preserves identity
})

test("CI-wait heuristic matches check-ish titles only", () => {
  assert.equal(looksLikeCIWait("gh pr checks 533 --watch"), true)
  assert.equal(looksLikeCIWait("poll workflow run 8123"), true)
  assert.equal(looksLikeCIWait("npm test"), false)
  assert.equal(looksLikeCIWait("read src/index.ts"), false)
})
