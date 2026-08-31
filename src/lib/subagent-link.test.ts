import { test } from "node:test"
import assert from "node:assert/strict"
import { isCompletedSubagentReportMissing, isSubagentOpenable, subagentBadge, subagentLinkFrom } from "./subagent-link.ts"
import type { Part } from "./sdk.ts"

// `in` rather than `??` so a test can pass an explicit undefined to mean
// "absent" without silently getting the default back.
function taskPart(overrides: { input?: unknown; metadata?: unknown; output?: unknown; status?: string; title?: string } = {}): Part {
  return {
    id: "prt_1",
    messageID: "msg_1",
    type: "tool",
    tool: "task",
    state: {
      status: (overrides.status ?? "completed") as "completed",
      title: overrides.title,
      input: "input" in overrides ? overrides.input : { description: "Review sync rework", subagent_type: "general", prompt: "..." },
      metadata: "metadata" in overrides ? overrides.metadata : { sessionId: "ses_child", parentSessionId: "ses_parent" },
      output: "output" in overrides ? overrides.output : "Report arrived after completion",
    },
  }
}

test("a completed task yields a link to its child session", () => {
  const link = subagentLinkFrom(taskPart())
  assert.equal(link?.sessionID, "ses_child")
  assert.equal(link?.title, "Review sync rework")
  assert.equal(link?.subagentType, "general")
})

test("the execution model is surfaced, which the swarm facade otherwise hides", () => {
  const link = subagentLinkFrom(
    taskPart({ metadata: { sessionId: "ses_child", model: { providerID: "openai", modelID: "gpt-5.6-sol" } } }),
  )
  assert.equal(link?.modelID, "gpt-5.6-sol")
})

// A tappable card that goes nowhere is worse than a plain one.
test("no child session means no link at all", () => {
  assert.equal(subagentLinkFrom(taskPart({ metadata: {} })), null)
  assert.equal(subagentLinkFrom(taskPart({ metadata: undefined })), null)
})

test("a blank session id does not count as a link", () => {
  assert.equal(subagentLinkFrom(taskPart({ metadata: { sessionId: "   " } })), null)
})

test("non-task tool parts are ignored", () => {
  const bash: Part = { id: "p", messageID: "m", type: "tool", tool: "bash", state: { status: "completed" } }
  assert.equal(subagentLinkFrom(bash), null)
})

test("non-tool parts are ignored", () => {
  assert.equal(subagentLinkFrom({ id: "p", messageID: "m", type: "text", text: "hi" }), null)
  assert.equal(subagentLinkFrom(null), null)
  assert.equal(subagentLinkFrom(undefined), null)
})

test("the tool title is the fallback when there is no description", () => {
  const link = subagentLinkFrom(taskPart({ input: { prompt: "..." }, title: "Fallback title" }))
  assert.equal(link?.title, "Fallback title")
})

test("a task with neither description nor title still gets a label", () => {
  const link = subagentLinkFrom(taskPart({ input: {}, title: undefined }))
  assert.equal(link?.title, "Subagent")
})

test("malformed input does not throw", () => {
  assert.equal(subagentLinkFrom(taskPart({ input: "not an object" }))?.title, "Subagent")
  assert.equal(subagentLinkFrom(taskPart({ metadata: [1, 2] })), null)
})

test("completed task with a child session warns when its report is absent or blank", () => {
  for (const output of [undefined, null, 0, {}, "", "   ", "\n\t "]) {
    assert.equal(isCompletedSubagentReportMissing(taskPart({ output })), true)
  }
})

test("a valid report that arrives after completion suppresses the missing-report warning", () => {
  assert.equal(isCompletedSubagentReportMissing(taskPart({ output: "Completed the requested review." })), false)
})

test("missing-report warning excludes non-terminal, failed, non-task, and unlinked parts", () => {
  assert.equal(isCompletedSubagentReportMissing(taskPart({ status: "running", output: undefined })), false)
  assert.equal(isCompletedSubagentReportMissing(taskPart({ status: "error", output: undefined })), false)
  assert.equal(isCompletedSubagentReportMissing(taskPart({ metadata: {}, output: undefined })), false)
  assert.equal(
    isCompletedSubagentReportMissing({ id: "p", messageID: "m", type: "tool", tool: "bash", state: { status: "completed" } }),
    false,
  )
})

// --- badge ---

test("swarm role beats the generic subagent type", () => {
  const link = subagentLinkFrom(
    taskPart({ input: { description: "d", subagent_type: "general", swarm_role: "senior-engineer" } }),
  )
  assert.equal(subagentBadge(link!), "senior-engineer")
})

test("subagent type is used when there is no swarm role", () => {
  assert.equal(subagentBadge(subagentLinkFrom(taskPart())!), "general")
})

test("a task with neither has no badge", () => {
  const link = subagentLinkFrom(taskPart({ input: { description: "d" } }))
  assert.equal(subagentBadge(link!), undefined)
})

// --- openability ---

test("a running subagent is openable, which is how you watch it work", () => {
  assert.equal(isSubagentOpenable(subagentLinkFrom(taskPart({ status: "running" }))!), true)
})

test("a pending subagent has nothing to show yet", () => {
  assert.equal(isSubagentOpenable(subagentLinkFrom(taskPart({ status: "pending" }))!), false)
})

test("a failed subagent is still worth opening to see why", () => {
  assert.equal(isSubagentOpenable(subagentLinkFrom(taskPart({ status: "error" }))!), true)
})
