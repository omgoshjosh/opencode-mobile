import type { Message, MessageWithParts, Part } from "./sdk.ts"
import { mergeNewestPage } from "./message-page.ts"

type Transcript = {
  messages: Message[]
  parts: Record<string, Part[]>
}

function parseMessages(response: MessageWithParts[]): Transcript {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}
  for (const item of response || []) {
    messages.push(item.info)
    parts[item.info.id] = item.parts || []
  }
  return { messages, parts }
}

/** Apply a bounded newest-page snapshot without resetting pagination state. */
export function mergeReconciledTranscript(state: Transcript, response: MessageWithParts[]): Transcript {
  const { messages, parts } = parseMessages(response)
  return {
    messages: mergeNewestPage({ existing: state.messages, newest: messages }),
    parts: { ...state.parts, ...parts },
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
