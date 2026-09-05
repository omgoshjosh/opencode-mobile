import assert from "node:assert/strict"
import { test } from "node:test"
import { sessionWorkerRows } from "./session-worker-rows.ts"

const session = (id: string, parentID?: string) => ({ id, parentID, title: id, time: { created: 0, updated: 0 } }) as never

test("a parentID matching a visible root nests only under that root", () => {
  const rows = sessionWorkerRows([session("root"), session("worker", "root"), session("orphan", "missing")], new Set(["root"]))
  assert.deepEqual(rows.map((row) => [row.session.id, row.depth]), [["root", 0], ["worker", 1]])
})

test("collapsed roots do not expose children as roots", () => {
  const rows = sessionWorkerRows([session("root"), session("worker", "root")], new Set())
  assert.deepEqual(rows.map((row) => row.session.id), ["root"])
})
