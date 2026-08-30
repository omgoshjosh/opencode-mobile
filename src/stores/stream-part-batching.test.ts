import assert from "node:assert/strict"
import { test } from "node:test"
import type { Message, Part, Session } from "../lib/sdk.ts"
import { flushPendingPartStatus, receiveStreamPart, useEvents } from "./events.ts"
import { cancelPendingStreamParts, flushPendingStreamParts, useSessions } from "./sessions.ts"

const message = (id: string, sessionID = "s1"): Message => ({ id, sessionID, role: "assistant", time: { created: 1 } })
const part = (id: string, text: string, messageID = "m1", sessionID = "s1"): Part => ({ id, text, messageID, sessionID, type: "text" })
const session = (id: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "",
  title: "",
  version: "1",
  time: { created: 1, updated: 1 },
})

function reset(sessionID = "s1") {
  cancelPendingStreamParts()
  useSessions.setState({
    currentSession: session(sessionID),
    activeTranscriptSessionID: sessionID,
    messages: [message("m1", sessionID), message("m2", sessionID)],
    parts: { keep: [part("keep", "unchanged", "keep", sessionID)] },
    previews: {},
    runningTools: {},
    pendingWakes: {},
  })
  useEvents.setState({ sessionStatus: { [sessionID]: { type: "busy" } }, statusText: {} })
}

test("1,000 synchronous stream parts commit once, preserve order, and retain latest replacements", () => {
  reset()
  let commits = 0
  let statusCommits = 0
  const unchanged = useSessions.getState().parts.keep
  const stop = useSessions.subscribe(() => commits++)
  const stopStatus = useEvents.subscribe(() => statusCommits++)
  for (let i = 0; i < 1_000; i++) receiveStreamPart(part(`p${i % 2}`, `v${i}`, i % 2 ? "m2" : "m1"), i)
  assert.equal(commits, 0, "receipt must not synchronously notify transcript subscribers")
  flushPendingPartStatus()
  flushPendingStreamParts()
  stop()
  stopStatus()
  assert.equal(commits, 1, "commit bound is independent of token count")
  assert.equal(statusCommits, 1, "foreground status commits are also bounded")
  const state = useSessions.getState()
  assert.deepEqual(state.parts.m1?.map((item) => item.id), ["p0"])
  assert.deepEqual(state.parts.m2?.map((item) => item.id), ["p1"])
  assert.equal(state.parts.m1?.[0].text, "v998")
  assert.equal(state.parts.m2?.[0].text, "v999")
  assert.equal(state.parts.keep[0].id, "keep")
  assert.strictEqual(state.parts.keep, unchanged, "unaffected part arrays retain identity")
})

test("background parts update batched preview data without foreground status activity", () => {
  reset()
  receiveStreamPart(part("background", "farm output", "m3", "s2"), 42)
  flushPendingPartStatus()
  flushPendingStreamParts()
  assert.equal(useSessions.getState().previews.s2?.text, "farm output")
  assert.equal(useEvents.getState().statusText.s2, undefined)
  assert.equal(useEvents.getState().sessionStatus.s2, undefined)
})

test("active transcript deactivation synchronously flushes then prevents timer revival", () => {
  reset()
  receiveStreamPart(part("p", "before navigation"), 7)
  useSessions.getState().setTranscriptActive("s1", false)
  assert.equal(useSessions.getState().parts.m1?.[0].text, "before navigation")
  receiveStreamPart(part("late", "stale"), 8)
  cancelPendingStreamParts()
  flushPendingPartStatus()
  assert.equal(useSessions.getState().parts.m1?.some((item) => item.id === "late"), false)
})

test("terminal tools and session switches flush or reject queued transcript generations", () => {
  reset()
  receiveStreamPart(part("text", "must arrive before terminal"), 10)
  receiveStreamPart({ id: "tool", messageID: "m1", sessionID: "s1", type: "tool", tool: "shell", state: { status: "completed" } }, 11)
  assert.equal(useSessions.getState().parts.m1?.[0].text, "must arrive before terminal")

  receiveStreamPart(part("stale", "wrong transcript"), 12)
  useSessions.setState({ currentSession: session("s2"), activeTranscriptSessionID: "s2" })
  flushPendingStreamParts()
  assert.equal(useSessions.getState().parts.m1?.some((item) => item.id === "stale"), false)
})

test("disconnect flushes pending work and cancels subsequent timer callbacks", () => {
  reset()
  receiveStreamPart(part("final", "flush before disconnect"), 20)
  useEvents.getState().disconnect()
  assert.equal(useSessions.getState().parts.m1?.[0].text, "flush before disconnect")
  cancelPendingStreamParts()
  flushPendingPartStatus()
  assert.equal(useEvents.getState().statusText.s1, undefined)
})
