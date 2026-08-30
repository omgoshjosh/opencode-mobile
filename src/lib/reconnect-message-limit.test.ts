import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { RECONCILE_MESSAGE_LIMIT } from "./message-page.ts"

function functionRegion(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}()`)
  assert.notEqual(start, -1, `${name} is defined`)

  const open = source.indexOf("{", start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++
    if (source[index] === "}") depth--
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`${name} has an unclosed body`)
}

test("busy-session reconnect resync fetches only the final message", () => {
  assert.equal(RECONCILE_MESSAGE_LIMIT, 1)

  const events = readFileSync(new URL("../stores/events.ts", import.meta.url), "utf8")
  const resync = functionRegion(events, "resyncBusySessions")
  assert.match(resync, /client\.session\.messages\(\s*sessionID\s*,\s*\{\s*limit:\s*RECONCILE_MESSAGE_LIMIT\s*\}\s*\)/)
})
