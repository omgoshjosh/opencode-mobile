import { test } from "node:test"
import assert from "node:assert/strict"
import type { Message, MessageWithParts, Part } from "./sdk.ts"
import { mergeOlderPage, mergeOlderParts } from "./message-page.ts"
import { createReconnectTranscriptCoordinator, mergeReconciledTranscript } from "./reconnect-transcript.ts"

const PAGE_SIZE = 2

function message(id: string): Message {
  return { id, sessionID: "s1", role: "assistant", time: { created: 1 } }
}

function page(...ids: string[]): MessageWithParts[] {
  return ids.map((id) => ({
    info: message(id),
    parts: [{ id: `p-${id}`, messageID: id, type: "text", text: id }],
  }))
}

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve: resolve! }
}

test("SSE reconnect merges offline open-session content with one bounded request", async () => {
  let state = {
    currentSessionID: "s1",
    activeSessionID: "s1",
    messages: [message("old"), { ...message("temp-1"), role: "user" as const }],
    parts: { old: [{ id: "p-old", messageID: "old", type: "text" as const, text: "old" }] },
    nextCursor: "cursor-1",
    hasMore: true,
  }
  const calls: Array<{ sessionID: string; options: { limit?: number } }> = []
  const client = {
    session: {
      messages: async (sessionID: string, options: { limit?: number }) => {
        calls.push({ sessionID, options })
        return page("old", "offline")
      },
    },
  }
  const reconcile = async () => {
    const response = await client.session.messages("s1", { limit: PAGE_SIZE })
    if (state.currentSessionID !== "s1" || state.activeSessionID !== "s1") return
    state = { ...state, ...mergeReconciledTranscript(state, response) }
  }
  const coordinator = createReconnectTranscriptCoordinator({
    reconnecting: true,
    activeSessionID: () => state.currentSessionID === state.activeSessionID ? state.currentSessionID : null,
    reconcileOpen: () => void reconcile(),
    refreshAfterIdle: () => void client.session.messages("s1", { limit: 99 }),
  })

  coordinator.onEvent()
  coordinator.onIdle("s1", true)
  await Promise.resolve()

  assert.deepEqual(calls, [{ sessionID: "s1", options: { limit: PAGE_SIZE } }])
  assert.deepEqual(state.messages.map((item) => item.id), ["old", "offline", "temp-1"])
  assert.equal(state.nextCursor, "cursor-1")
  assert.equal(state.hasMore, true)
})

test("SSE busy resync settles status without a second open-transcript request", async () => {
  let status = "busy"
  const calls: Array<{ limit: number }> = []
  const client = {
    session: {
      messages: async (_sessionID: string, options: { limit: number }) => {
        calls.push(options)
        return page("missed")
      },
    },
  }
  const coordinator = createReconnectTranscriptCoordinator({
    reconnecting: true,
    activeSessionID: () => "s1",
    reconcileOpen: () => {
      void client.session.messages("s1", { limit: PAGE_SIZE })
    },
    refreshAfterIdle: () => {
      void client.session.messages("s1", { limit: PAGE_SIZE })
    },
  })

  coordinator.onEvent()
  // The separate one-message status probe finds the missed completion.
  await client.session.messages("s1", { limit: 1 })
  status = "idle"
  coordinator.onIdle("s1", true)

  assert.equal(status, "idle")
  assert.deepEqual(calls, [{ limit: PAGE_SIZE }, { limit: 1 }])
})

test("a late reconnect response cannot overwrite a newly selected session", async () => {
  const response = deferred<MessageWithParts[]>()
  let state = { currentSessionID: "s1", activeSessionID: "s1", messages: [message("one")], parts: {} as Record<string, Part[]> }
  const client = { session: { messages: async (_sessionID: string, options: { limit: number }) => {
    assert.deepEqual(options, { limit: PAGE_SIZE })
    return response.promise
  } } }
  const reconcile = async () => {
    const page = await client.session.messages("s1", { limit: PAGE_SIZE })
    if (state.currentSessionID !== "s1" || state.activeSessionID !== "s1") return
    state = { ...state, ...mergeReconciledTranscript(state, page) }
  }
  const coordinator = createReconnectTranscriptCoordinator({
    reconnecting: true,
    activeSessionID: () => state.currentSessionID,
    reconcileOpen: () => void reconcile(),
    refreshAfterIdle: () => {},
  })

  coordinator.onEvent()
  state = { currentSessionID: "s2", activeSessionID: "s2", messages: [message("two")], parts: {} }
  response.resolve(page("late"))
  await Promise.resolve()

  assert.deepEqual(state.messages.map((item) => item.id), ["two"])
})

test("a snapshot replaces a transient synthetic user envelope without duplicates", () => {
  const internal = { ...message("report"), role: "user" as const }
  const state = {
    messages: [internal],
    parts: { report: [{ id: "report-part", messageID: "report", type: "text" as const, text: '<task id="x">internal</task>' }] },
  }
  const response = [
    { info: internal, parts: [{ id: "report-part", messageID: "report", type: "text" as const, text: '<task id="x">internal</task>' }] },
    ...page("answer", "answer"),
  ]

  const merged = mergeReconciledTranscript(state, response)
  assert.deepEqual(merged.messages.map((item) => item.id), ["answer"])
  assert.equal(merged.parts.report, undefined)
  assert.deepEqual(merged.parts.answer.map((part) => part.id), ["p-answer"])
})

test("older-page API call keeps its cursor and merges beneath a reconnect page", async () => {
  const calls: Array<{ limit: number; before?: string }> = []
  const client = { session: { messagesPage: async (_sessionID: string, options: { limit: number; before?: string }) => {
    calls.push(options)
    return { items: page("old"), nextCursor: "older-cursor" }
  } } }
  const existing = [message("new")]
  const response = await client.session.messagesPage("s1", { limit: PAGE_SIZE, before: "cursor-1" })
  const older = response.items.map((item) => item.info)
  const messages = mergeOlderPage({ existing, older })
  const parts = mergeOlderParts({ new: page("new")[0].parts }, { old: response.items[0].parts })

  assert.deepEqual(calls, [{ limit: PAGE_SIZE, before: "cursor-1" }])
  assert.deepEqual(messages.map((item) => item.id), ["old", "new"])
  assert.equal(parts.old[0].text, "old")
  assert.equal(response.nextCursor, "older-cursor")
})
