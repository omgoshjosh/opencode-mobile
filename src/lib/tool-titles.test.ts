import { test } from "node:test"
import assert from "node:assert/strict"
import {
  TOOL_RUN_COLLAPSE_THRESHOLD,
  shouldCollapseToolRun,
  summarizeToolRun,
  toolCallTitle,
} from "./tool-titles.ts"

// --- titles ---

test("the server's own title wins when present", () => {
  assert.equal(
    toolCallTitle({ tool: "bash", state: { title: "Shows worktree state", input: { command: "git status" } } }),
    "Shows worktree state",
  )
})

// The observed failure: thirteen cards all reading "bash".
test("a bash call is titled by its command, not the word bash", () => {
  assert.equal(toolCallTitle({ tool: "bash", state: { input: { command: "git status --porcelain" } } }), "git status --porcelain")
})

test("multi-line commands are titled by their first line", () => {
  assert.equal(toolCallTitle({ tool: "bash", state: { input: { command: "npm test\necho done" } } }), "npm test")
})

test("very long commands are capped with an ellipsis", () => {
  const title = toolCallTitle({ tool: "bash", state: { input: { command: "x".repeat(200) } } })
  assert.ok(title.length <= 60)
  assert.ok(title.endsWith("…"))
})

test("file tools are titled by the file's basename", () => {
  assert.equal(toolCallTitle({ tool: "read", state: { input: { filePath: "/a/b/store.ts" } } }), "read store.ts")
  assert.equal(toolCallTitle({ tool: "edit", state: { input: { file_path: "/a/b/c.tsx" } } }), "edit c.tsx")
})

test("search tools are titled by their pattern", () => {
  assert.equal(toolCallTitle({ tool: "grep", state: { input: { pattern: "TODO" } } }), "grep TODO")
})

test("webfetch is titled by hostname, not the full URL", () => {
  assert.equal(
    toolCallTitle({ tool: "webfetch", state: { input: { url: "https://api.github.com/repos/x/y" } } }),
    "webfetch api.github.com",
  )
})

test("a malformed URL falls back to the raw text rather than throwing", () => {
  assert.match(toolCallTitle({ tool: "webfetch", state: { input: { url: "not a url" } } }), /webfetch/)
})

test("task calls are titled by their description", () => {
  assert.equal(toolCallTitle({ tool: "task", state: { input: { description: "Review sync rework" } } }), "Review sync rework")
})

test("the bare tool name is the floor, never empty", () => {
  assert.equal(toolCallTitle({ tool: "bash", state: {} }), "bash")
  assert.equal(toolCallTitle({ tool: "bash" }), "bash")
  assert.equal(toolCallTitle({}), "tool")
})

// --- run summaries ---

const done = { tool: "bash", state: { status: "completed", input: { command: "a" } } }
const failed = { tool: "bash", state: { status: "error", input: { command: "b" } } }
const running = { tool: "bash", state: { status: "running", input: { command: "c" } } }

test("a run counts totals, failures and in-flight calls", () => {
  const summary = summarizeToolRun([done, failed, running, done])
  assert.equal(summary.count, 4)
  assert.equal(summary.failed, 1)
  assert.equal(summary.running, 1)
})

test("the preview names the first calls by their derived titles", () => {
  const summary = summarizeToolRun([done, failed, running])
  assert.deepEqual(summary.preview, ["a", "b"])
})

test("empty runs summarise without throwing", () => {
  const summary = summarizeToolRun([])
  assert.equal(summary.count, 0)
  assert.deepEqual(summary.preview, [])
})

// --- collapse threshold ---

test("small runs stay inline; big runs collapse", () => {
  assert.equal(shouldCollapseToolRun(TOOL_RUN_COLLAPSE_THRESHOLD - 1), false)
  assert.equal(shouldCollapseToolRun(TOOL_RUN_COLLAPSE_THRESHOLD), true)
  assert.equal(shouldCollapseToolRun(13), true)
})
