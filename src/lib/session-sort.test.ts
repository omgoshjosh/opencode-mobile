import { test } from "node:test"
import assert from "node:assert/strict"
import { parseSessionSort, sortSessions } from "./session-sort.ts"

const s = (title: string | undefined, updated: number) => ({ title, time: { updated } })

test("newest and oldest order by updated time", () => {
  const list = [s("a", 1), s("b", 3), s("c", 2)]
  assert.deepEqual(sortSessions(list, "newest").map((x) => x.title), ["b", "c", "a"])
  assert.deepEqual(sortSessions(list, "oldest").map((x) => x.title), ["a", "c", "b"])
})

test("name sorts are case-insensitive and reversible", () => {
  const list = [s("beta", 1), s("Alpha", 2), s("gamma", 3)]
  assert.deepEqual(sortSessions(list, "name-asc").map((x) => x.title), ["Alpha", "beta", "gamma"])
  assert.deepEqual(sortSessions(list, "name-desc").map((x) => x.title), ["gamma", "beta", "Alpha"])
})

test("untitled sessions sink to the end in both name directions", () => {
  const list = [s(undefined, 5), s("alpha", 1), s("", 9)]
  // Nameless entries order newest-first among themselves (9 before 5).
  assert.deepEqual(sortSessions(list, "name-asc").map((x) => x.title), ["alpha", "", undefined])
  assert.deepEqual(sortSessions(list, "name-desc").map((x) => x.title), ["alpha", "", undefined])
})

test("identical names tie-break newest first", () => {
  const list = [s("run", 1), s("run", 3), s("run", 2)]
  assert.deepEqual(sortSessions(list, "name-asc").map((x) => x.time.updated), [3, 2, 1])
})

test("the input array is not mutated", () => {
  const list = [s("b", 1), s("a", 2)]
  sortSessions(list, "name-asc")
  assert.equal(list[0].title, "b")
})

test("stored garbage parses to the default", () => {
  assert.equal(parseSessionSort("name-asc"), "name-asc")
  assert.equal(parseSessionSort("sideways"), "newest")
  assert.equal(parseSessionSort(undefined), "newest")
})
