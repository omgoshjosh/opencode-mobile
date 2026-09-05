import type { Message, MessageWithParts, Part } from "./sdk.ts"
import { mergeNewestPage } from "./message-page.ts"
import { isHiddenSyntheticUserMessage } from "./transcript-visibility.ts"

type Transcript = {
  messages: Message[]
  parts: Record<string, Part[]>
}

function parseMessages(response: MessageWithParts[]): Transcript {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}
  for (const item of response || []) {
    if (isHiddenSyntheticUserMessage(item.info, item.parts)) continue
    messages.push(item.info)
    parts[item.info.id] = item.parts || []
  }
  return { messages, parts }
}

/** Apply a bounded newest-page snapshot without resetting pagination state. */
export function mergeReconciledTranscript(state: Transcript, response: MessageWithParts[]): Transcript {
  const hidden = new Set(
    response.filter((item) => isHiddenSyntheticUserMessage(item.info, item.parts)).map((item) => item.info.id),
  )
  const { messages, parts } = parseMessages(response)
  const mergedParts: Record<string, Part[]> = { ...state.parts }
  for (const messageID of hidden) delete mergedParts[messageID]
  for (const [messageID, incoming] of Object.entries(parts)) {
    // The page is authoritative for settled messages. Deduping by part ID also
    // tolerates an overlap at the page boundary without rendering a part twice.
    mergedParts[messageID] = [...new Map(incoming.map((part) => [part.id, part])).values()]
  }
  return {
    messages: mergeNewestPage({ existing: state.messages.filter((message) => !hidden.has(message.id)), newest: messages }),
    parts: mergedParts,
  }
}

/**
 * Actual SSE reconnect wiring: one reconnect snapshot for the initially open
 * transcript, while normal idle refreshes remain available for other cases.
 */
export function createReconnectTranscriptCoordinator(input: {
  reconnecting: boolean
  activeSessionID: () => string | null
  reconcileOpen: () => void
  refreshAfterIdle: () => void
}) {
  let attempted = false
  let reconnectSessionID: string | null = null

  return {
    onEvent() {
      if (!input.reconnecting || attempted) return
      attempted = true
      reconnectSessionID = input.activeSessionID()
      if (reconnectSessionID) input.reconcileOpen()
    },
    onIdle(sessionID: string, active: boolean) {
      if (!active || reconnectSessionID === sessionID) return
      input.refreshAfterIdle()
    },
  }
}
