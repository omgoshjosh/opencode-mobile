// #53 review round 2 (PR #54 review 5962102961): depth, partial ancestry, numeric overlap, terminal aggregate jobs.
import assert from "node:assert/strict"
import { test } from "node:test"
import * as summary from "./list-worker-summary.ts"

type Statuses = Record<string, unknown>
type Parents = Record<string, string | null>

const count = (statuses: Statuses, parents: Parents = {}, terminalChildIDs: Record<string, true> = {}) =>
  summary.listWorkerSummary({ rootID: "root", statuses: statuses as never, sessions: [], parents, terminalChildIDs }).count

// Read through the namespace so a red run fails on the assertion, not on a missing export.
const unplaced = (statuses: Statuses, parents: Parents): string[] =>
  ((summary as Record<string, unknown>).unplacedWorkerIDs as undefined | ((input: object) => string[]))?.({ statuses, sessions: [], parents }) ?? []

test("#53 r2 (#1): a busy worker 40 levels under an idle chain counts once", () => {
  const parents: Parents = { root: null, s1: "root" }
  for (let depth = 2; depth <= 40; depth++) parents[`s${depth}`] = `s${depth - 1}`
  assert.equal(count({ root: { type: "idle" }, s40: { type: "busy" } }, parents), 1)
  assert.deepEqual(unplaced({ s40: { type: "busy" } }, parents), [])
})

test("#53 r2 (#2): a worker whose chain has an unknown link is reported unplaced, never counted and never treated as a root", () => {
  const statuses = { w: { type: "busy" }, idle: { type: "idle" } }
  assert.equal(count(statuses, { w: "m" }), 0)
  assert.deepEqual(unplaced(statuses, { w: "m", root: null }), ["w"])
  // Once the manager is known, the same worker is placed and counted exactly.
  assert.equal(count(statuses, { w: "m", m: "root", root: null }), 1)
  assert.deepEqual(unplaced(statuses, { w: "m", m: "root", root: null }), [])
  // A worker under a different, known root is placed (just not ours); cycles are not workers of anyone.
  assert.deepEqual(unplaced({ x: { type: "busy" } }, { x: "other", other: null }), [])
  assert.deepEqual(unplaced({ a: { type: "busy" } }, { a: "b", b: "a" }), [])
})

test("#53 r2 (#3): a numeric aggregate does not double count its own working children", () => {
  const statuses = { root: { type: "idle", background: { running: 2, jobs: [] } }, k1: { type: "busy" }, k2: { type: "busy" } }
  assert.equal(count(statuses, { k1: "root", k2: "root", root: null }), 2)
})

test("#53 r2 (#5): an aggregate job the client saw finish does not count", () => {
  const statuses = { root: { type: "idle", background: { running: true, jobs: [{ id: "j", sessionID: "j", status: "running" }] } }, j: { type: "idle" } }
  assert.equal(count(statuses, { j: "root" }, { j: true }), 0)
})

test("#53 r2 (#2): the list hint names unplaced workers without inventing a total", () => {
  const label = (summary as Record<string, unknown>).unplacedWorkersLabel as ((n: number) => string) | undefined
  assert.equal(label?.(0), "")
  assert.equal(label?.(1), "1 working session not yet placed under a root — counts may be low")
  assert.equal(label?.(2), "2 working sessions not yet placed under a root — counts may be low")
})
