import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_EXTRACTED_LINKS, extractLinks } from "./link-extract.ts"

test("plain output with no URLs yields nothing", () => {
  assert.deepEqual(extractLinks("all tests passed\n0 failures"), [])
  assert.deepEqual(extractLinks(""), [])
  assert.deepEqual(extractLinks(null), [])
})

test("URLs are found inside log lines", () => {
  const out = extractLinks("pushed to https://github.com/x/y/pull/182 successfully")
  assert.deepEqual(out, ["https://github.com/x/y/pull/182"])
})

// "see https://x.dev." almost always means the URL without the dot.
test("trailing sentence punctuation is stripped", () => {
  assert.deepEqual(extractLinks("see https://docs.expo.dev."), ["https://docs.expo.dev"])
  assert.deepEqual(extractLinks("go to https://a.dev/path, then stop"), ["https://a.dev/path"])
})

test("quotes and brackets terminate a URL", () => {
  assert.deepEqual(extractLinks('url="https://a.dev/x"'), ["https://a.dev/x"])
  assert.deepEqual(extractLinks("(https://a.dev/y)"), ["https://a.dev/y"])
})

test("duplicates collapse, keeping first-appearance order", () => {
  const out = extractLinks("https://b.dev then https://a.dev then https://b.dev again")
  assert.deepEqual(out, ["https://b.dev", "https://a.dev"])
})

test("non-http schemes are not guessed at", () => {
  assert.deepEqual(extractLinks("ftp://files.example.com and www.example.com"), [])
})

test("a log that prints thousands of URLs is capped", () => {
  const text = Array.from({ length: 100 }, (_, i) => `https://example.com/${i}`).join("\n")
  assert.equal(extractLinks(text).length, MAX_EXTRACTED_LINKS)
})
