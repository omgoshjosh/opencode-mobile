import { test } from "node:test"
import assert from "node:assert/strict"
import {
  TOOL_RUN_COLLAPSE_THRESHOLD,
  commandIntent,
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

// The server stamps title="bash" as a placeholder when the call starts —
// verified against the live API. Preferring it verbatim reintroduced the
// wall of cards all reading "bash".
test("a server title that just repeats the tool name is treated as absent", () => {
  assert.equal(
    toolCallTitle({ tool: "bash", state: { title: "bash", input: { command: "npm test" } } }),
    "npm test",
  )
  assert.equal(toolCallTitle({ tool: "write", state: { title: "write", input: {} } }), "write")
})

// --- commandIntent: env preamble stripping ---

test("commandIntent steps over export/cd/VAR= preamble to the real command", () => {
  assert.equal(
    commandIntent('export PATH="/opt/homebrew/bin:$PATH"; cd /deep/path && npm test'),
    "npm test",
  )
  assert.equal(commandIntent("cd /w && FOO=1 BAR=2"), "FOO=1 BAR=2")
  assert.equal(commandIntent("npm run build"), "npm run build")
})

test("commandIntent keeps a preamble-only line rather than showing nothing", () => {
  assert.equal(commandIntent('export PATH="/x"'), 'export PATH="/x"')
})

test("bash titles use the stripped intent", () => {
  const part = { tool: "bash", state: { title: "bash", input: { command: 'export A=1; cd /x && git status' } } }
  assert.equal(toolCallTitle(part), "git status")
})

// --- task fallbacks ---

test("task falls back description -> summary -> prompt first line", () => {
  assert.equal(toolCallTitle({ tool: "task", state: { input: { description: "Fix drain races" } } }), "Fix drain races")
  assert.equal(toolCallTitle({ tool: "task", state: { input: { summary: "QA pass" } } }), "QA pass")
  assert.equal(
    toolCallTitle({ tool: "task", state: { input: { prompt: "Review the uncommitted diff\nlots more" } } }),
    "Review the uncommitted diff",
  )
  assert.equal(toolCallTitle({ tool: "task", state: { input: {} } }), "task")
})

// --- new tools ---

test("skill, graph_plan and sendmessage derive titles from their inputs", () => {
  assert.equal(toolCallTitle({ tool: "skill", state: { input: { name: "code-reviewer" } } }), "skill: code-reviewer")
  assert.equal(
    toolCallTitle({ tool: "graph_plan", state: { input: { goal: "Ship the drain feature safely" } } }),
    "Ship the drain feature safely",
  )
  assert.equal(
    toolCallTitle({ tool: "sendmessage", state: { input: { to: "agents-f3", summary: "Yondi coordination check" } } }),
    "Yondi coordination check",
  )
  assert.equal(toolCallTitle({ tool: "sendmessage", state: { input: { to: "agents-f3" } } }), "message agents-f3")
})
