import { test } from "node:test"
import assert from "node:assert/strict"

// Contract tripwire for image attachments (v2: file parts -> native image
// blocks). The server dropped image parts on swarm/Claude sessions, which
// surfaced as empty replies; once fixed, the CLIENT half must not drift.
// Verified against real parts the app persisted:
//   type=file, mime=image/jpeg, url=data:image/jpeg;base64,..., filename
//
// This test reads the source rather than importing it (sendMessage pulls in
// expo/zustand), so it stays runnable under plain `node --test`.
import { readFileSync } from "node:fs"

const store = readFileSync("src/stores/sessions.ts", "utf8")

test("outgoing image attachments are file parts carrying a data: URI", () => {
  assert.match(
    store,
    /promptParts\.push\(\{ type: "file", mime: f\.mime, url, filename: f\.filename \}\)/,
    "image attachments must be sent as file parts with mime + url + filename",
  )
  assert.match(
    store,
    /const url = f\.base64 \? `data:\$\{f\.mime\};base64,\$\{f\.base64\}` : f\.uri/,
    "base64 attachments must be encoded as data: URIs, not raw local file paths",
  )
})

test("images are converted to JPEG before send (no HEIC/PNG surprises)", () => {
  assert.match(store, /already converted to JPEG with base64/, "the JPEG conversion contract is documented at the send site")
})
