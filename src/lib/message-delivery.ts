// Delivery state for a message in the transcript.
//
// Mobile appends an optimistic message with a `temp-` id the moment you hit
// send, then the real one arrives over SSE and replaces it. Until then the
// bubble looked identical to a delivered message, so there was no way to tell
// "the server has this" from "this is still in flight" — or, worse, from
// "this failed and is never coming back".
//
// Failure was especially bad: sendMessage's catch called refreshMessages(),
// which replaces messages wholesale from the server, so the optimistic message
// was deleted and the text the user had typed vanished with only a generic
// error banner. Marking it failed (and keeping it) is what lets the UI say so.
//
// Dependency-free so it's testable under plain `node --test`.

export type DeliveryState = "sent" | "queued" | "failed"

/** Optimistic messages carry a client-generated id until the server echoes one. */
export const OPTIMISTIC_ID_PREFIX = "temp-"

export function isOptimisticID(messageID: string): boolean {
  return messageID.startsWith(OPTIMISTIC_ID_PREFIX)
}

export function deliveryState(input: {
  messageID: string
  failedIDs?: Record<string, true> | null
}): DeliveryState {
  if (input.failedIDs?.[input.messageID]) return "failed"
  // A server-assigned id means the server has it; only client ids are pending.
  return isOptimisticID(input.messageID) ? "queued" : "sent"
}

/**
 * Merge a server message list with any still-pending optimistic messages.
 *
 * `refreshMessages` replaced the list wholesale, which is correct for server
 * state but throws away anything not yet acknowledged — including a message
 * that just failed to send. Keep optimistic entries that the server list does
 * not already account for, and append them in their original order so the
 * transcript still reads chronologically.
 */
export function mergePendingMessages<T extends { id: string }>(serverMessages: T[], previous: T[]): T[] {
  const pending = previous.filter((m) => isOptimisticID(m.id))
  if (pending.length === 0) return serverMessages
  const seen = new Set(serverMessages.map((m) => m.id))
  return [...serverMessages, ...pending.filter((m) => !seen.has(m.id))]
}

/**
 * Is a server-acknowledged user message still WAITING BEHIND another?
 *
 * The server queues prompts while a session is busy, but an acked message
 * looked identical to one being worked on. The first cut over-reported:
 * it tagged EVERY user message newer than the newest assistant reply —
 * including the one the model is answering right now, whose reply message
 * doesn't exist yet. That read as "queued" for the very message being
 * worked on, which is the opposite of the truth.
 *
 * Correct rule: among the unanswered user messages, the OLDEST is in
 * flight; only the ones sent after it are actually waiting their turn.
 */
export function awaitingTurn(input: {
  role?: string
  createdAt?: number
  busy: boolean
  /** Created time of the oldest user message with no reply yet — the one in flight. */
  inFlightUserCreatedAt?: number | null
}): boolean {
  if (!input.busy || input.role !== "user" || !input.createdAt) return false
  if (input.inFlightUserCreatedAt == null) return false
  return input.createdAt > input.inFlightUserCreatedAt
}

/**
 * The oldest user message that has no assistant reply after it — i.e. the
 * turn currently being worked on. Null when every prompt has been answered.
 */
export function inFlightUserCreatedAt(
  messages: ReadonlyArray<{ role?: string; time?: { created?: number } }> | null | undefined,
): number | null {
  const list = messages ?? []
  let newestAssistant: number | null = null
  for (const m of list) {
    if (m.role === "assistant" && m.time?.created != null) {
      newestAssistant = Math.max(newestAssistant ?? 0, m.time.created)
    }
  }
  let oldestUnanswered: number | null = null
  for (const m of list) {
    if (m.role !== "user" || m.time?.created == null) continue
    if (newestAssistant != null && m.time.created <= newestAssistant) continue
    oldestUnanswered = oldestUnanswered == null ? m.time.created : Math.min(oldestUnanswered, m.time.created)
  }
  return oldestUnanswered
}
