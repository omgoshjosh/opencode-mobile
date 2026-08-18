import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parsePreviewMap,
  MAX_TRACKED_PREVIEWS,
  PREVIEW_MAX_CHARS,
  dropPreview,
  previewFromParts,
  previewText,
  putPreview,
  type PreviewMap,
} from "./session-preview.ts"

// --- text normalisation ---

test("plain text passes through", () => {
  assert.equal(previewText("Fix the keyboard offset"), "Fix the keyboard offset")
})

test("newlines and runs of whitespace collapse to single spaces", () => {
  assert.equal(previewText("one\n\n  two\t\tthree"), "one two three")
})

// Rendered raw in a one-line row, a fence produces stray backticks and gaps.
test("fenced code blocks are dropped", () => {
  assert.equal(previewText("before\n```js\nconst x = 1\n```\nafter"), "before after")
})

test("inline code keeps its content but loses the backticks", () => {
  assert.equal(previewText("run `npm ci` first"), "run npm ci first")
})

test("long text is truncated with an ellipsis", () => {
  const out = previewText("a".repeat(500))!
  assert.equal(out.length, PREVIEW_MAX_CHARS)
  assert.ok(out.endsWith("…"))
})

test("text exactly at the limit is not truncated", () => {
  const out = previewText("a".repeat(PREVIEW_MAX_CHARS))!
  assert.equal(out.length, PREVIEW_MAX_CHARS)
  assert.ok(!out.endsWith("…"))
})

// Callers leave the previous preview standing rather than blanking the row.
test("empty or whitespace-only content yields null", () => {
  assert.equal(previewText(""), null)
  assert.equal(previewText("   \n  "), null)
  assert.equal(previewText(null), null)
  assert.equal(previewText(undefined), null)
})

test("a message that is only a code fence yields null", () => {
  assert.equal(previewText("```\ncode\n```"), null)
})

// --- tracking ---

test("a preview can be recorded and read back", () => {
  const map = putPreview({}, "s1", { text: "hello", at: 10 })
  assert.equal(map.s1.text, "hello")
})

test("a newer preview replaces an older one", () => {
  let map = putPreview({}, "s1", { text: "first", at: 10 })
  map = putPreview(map, "s1", { text: "second", at: 20 })
  assert.equal(map.s1.text, "second")
})

// Streaming parts arrive repeatedly; a late earlier chunk must not rewind.
test("an out-of-order older preview is ignored", () => {
  let map = putPreview({}, "s1", { text: "newer", at: 20 })
  map = putPreview(map, "s1", { text: "older", at: 10 })
  assert.equal(map.s1.text, "newer")
})

test("a null text leaves the existing preview alone", () => {
  const map = putPreview({ s1: { text: "keep", at: 5 } }, "s1", {
    text: null,
    at: 99,
  })
  assert.equal(map.s1.text, "keep")
})

test("an empty session id is ignored", () => {
  assert.deepEqual(putPreview({}, "", { text: "x", at: 1 }), {})
})

test("tracked previews are bounded, evicting the oldest", () => {
  let map: PreviewMap = {}
  for (let i = 0; i < MAX_TRACKED_PREVIEWS + 10; i++) {
    map = putPreview(map, `s${i}`, { text: `t${i}`, at: i })
  }
  assert.equal(Object.keys(map).length, MAX_TRACKED_PREVIEWS)
  assert.equal(map.s0, undefined)
  assert.ok(map[`s${MAX_TRACKED_PREVIEWS + 9}`])
})

test("put does not mutate its input", () => {
  const original: PreviewMap = {}
  putPreview(original, "s1", { text: "x", at: 1 })
  assert.deepEqual(original, {})
})

// --- drop ---

test("dropping removes one entry", () => {
  const map = putPreview({}, "s1", { text: "x", at: 1 })
  assert.deepEqual(dropPreview(map, "s1"), {})
})

test("dropping an absent entry is a no-op", () => {
  const map = putPreview({}, "s1", { text: "x", at: 1 })
  assert.equal(dropPreview(map, "nope"), map)
})

// --- seeding from a loaded transcript ---

test("the newest text part becomes the preview", () => {
  const got = previewFromParts([
    { type: "text", text: "older", time: { start: 1 } },
    { type: "text", text: "newest", time: { start: 2 } },
  ])
  assert.equal(got?.text, "newest")
  assert.equal(got?.at, 2)
})

// A transcript usually ends on a step-finish or tool call, neither of which
// says anything a human wants to read in a list row.
test("trailing non-text parts are skipped", () => {
  const got = previewFromParts([
    { type: "text", text: "the answer" },
    { type: "tool" },
    { type: "step-finish" },
  ])
  assert.equal(got?.text, "the answer")
})

test("a transcript with no usable text yields null", () => {
  assert.equal(previewFromParts([{ type: "tool" }, { type: "step-start" }]), null)
  assert.equal(previewFromParts([{ type: "text", text: "   " }]), null)
  assert.equal(previewFromParts([]), null)
  assert.equal(previewFromParts(null), null)
})

test("a seeded preview is normalised like a streamed one", () => {
  const got = previewFromParts([{ type: "text", text: "one\n\ntwo   three" }])
  assert.equal(got?.text, "one two three")
})

test("a part with no timestamp still seeds, at the epoch", () => {
  assert.equal(previewFromParts([{ type: "text", text: "hi" }])?.at, 0)
})

// --- persistence round-trip ---

test("a persisted preview map parses back; corrupt storage parses to empty", () => {
  const map = { s1: { text: "running tests", at: 5 } }
  assert.deepEqual(parsePreviewMap(JSON.stringify(map)), map)
  assert.deepEqual(parsePreviewMap(null), {})
  assert.deepEqual(parsePreviewMap("garbage"), {})
  assert.deepEqual(parsePreviewMap('{"s1":{"text":42,"at":1}}'), {})
})
