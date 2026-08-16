import { test } from "node:test"
import assert from "node:assert/strict"
import { depthOf, descendantsOf, indexByID, rootIDOf, type TreeSession } from "./session-tree.ts"

// root -> child -> grandchild, the shape a swarm's task graph actually makes.
const tree: TreeSession[] = [
  { id: "root" },
  { id: "child", parentID: "root" },
  { id: "grandchild", parentID: "child" },
  { id: "otherRoot" },
  { id: "otherChild", parentID: "otherRoot" },
]
const byID = indexByID(tree)

// --- ancestor resolution ---

test("a root resolves to itself", () => {
  assert.equal(rootIDOf({ id: "root" }, byID), "root")
})

test("a direct child resolves to its root", () => {
  assert.equal(rootIDOf({ id: "child", parentID: "root" }, byID), "root")
})

// The bug: this used to resolve to "child", so a grandchild formed its own
// group beside the swarm instead of nesting inside it.
test("a grandchild resolves to the root, not its parent", () => {
  assert.equal(rootIDOf({ id: "grandchild", parentID: "child" }, byID), "root")
})

test("arbitrary depth resolves to the top", () => {
  const deep: TreeSession[] = [{ id: "r" }]
  for (let i = 0; i < 20; i++) deep.push({ id: `n${i}`, parentID: i === 0 ? "r" : `n${i - 1}` })
  assert.equal(rootIDOf(deep.at(-1)!, indexByID(deep)), "r")
})

// The list is capped, so a child's parent is frequently not loaded. Grouping
// by the deepest resolvable id keeps such sessions with their visible kin.
test("an unloaded parent resolves to that parent's id rather than failing", () => {
  assert.equal(rootIDOf({ id: "orphan", parentID: "missing" }, byID), "missing")
})

test("a cycle terminates instead of hanging the render", () => {
  const cyclic = indexByID([
    { id: "a", parentID: "b" },
    { id: "b", parentID: "a" },
  ])
  const result = rootIDOf({ id: "a", parentID: "b" }, cyclic)
  assert.ok(result === "a" || result === "b")
})

test("a self-parented session terminates", () => {
  const self = indexByID([{ id: "s", parentID: "s" }])
  assert.ok(rootIDOf({ id: "s", parentID: "s" }, self))
})

// --- descendants ---

test("descendants include grandchildren, not just direct children", () => {
  const got = descendantsOf(tree, new Set(["root"])).map((s) => s.id)
  assert.deepEqual(got.sort(), ["child", "grandchild"])
})

test("roots themselves are not their own descendants", () => {
  assert.equal(descendantsOf(tree, new Set(["root"])).some((s) => s.id === "root"), false)
})

test("descendants of an unrelated root are excluded", () => {
  const got = descendantsOf(tree, new Set(["otherRoot"])).map((s) => s.id)
  assert.deepEqual(got, ["otherChild"])
})

test("multiple roots resolve independently", () => {
  const got = descendantsOf(tree, new Set(["root", "otherRoot"])).map((s) => s.id)
  assert.deepEqual(got.sort(), ["child", "grandchild", "otherChild"])
})

test("no roots means no descendants", () => {
  assert.deepEqual(descendantsOf(tree, new Set()), [])
  assert.deepEqual(descendantsOf([], new Set(["root"])), [])
})

// --- depth ---

test("depth counts generations below the root", () => {
  assert.equal(depthOf({ id: "root" }, byID), 0)
  assert.equal(depthOf({ id: "child", parentID: "root" }, byID), 1)
  assert.equal(depthOf({ id: "grandchild", parentID: "child" }, byID), 2)
})

test("depth terminates on a cycle", () => {
  const cyclic = indexByID([
    { id: "a", parentID: "b" },
    { id: "b", parentID: "a" },
  ])
  assert.ok(depthOf({ id: "a", parentID: "b" }, cyclic) <= 2)
})
