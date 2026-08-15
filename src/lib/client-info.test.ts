import { test } from "node:test"
import assert from "node:assert/strict"
import { clientInfoFrom, clientInfoHeader, clientInfoLabel } from "./client-info.ts"

test("header identifies version, build and platform", () => {
  const h = clientInfoHeader({ version: "0.4.12", build: "29780534", platform: "android" })
  assert.equal(h, "opencode-mobile/0.4.12 (build 29780534; android)")
})

test("settings label leads with version and names the build", () => {
  assert.equal(clientInfoLabel({ version: "0.4.12", build: "29780534", platform: "android" }), "0.4.12 (build 29780534)")
})

// A header containing a newline or stray delimiter would corrupt the request.
test("header strips characters that would break the header or its grammar", () => {
  const h = clientInfoHeader({ version: "1.0\n0", build: "a;b(c)", platform: "android" })
  assert.ok(!h.includes("\n"), "no newline")
  assert.equal(h, "opencode-mobile/1.00 (build abc; android)")
})

test("unknown values still produce a well-formed header", () => {
  assert.equal(
    clientInfoHeader({ version: "unknown", build: "unknown", platform: "ios" }),
    "opencode-mobile/unknown (build unknown; ios)",
  )
})

test("clientInfoFrom fills in unknowns for absent native values", () => {
  assert.deepEqual(clientInfoFrom({ version: null, build: undefined, platform: "android" }), {
    version: "unknown",
    build: "unknown",
    platform: "android",
  })
})
