import { awaitingTurn, isOptimisticID } from "./message-delivery.ts"

export interface QueueMessage {
  id: string
  sessionID: string
  role: string
  createdAt?: number
}

/** Server-acknowledged prompts waiting behind the active turn, in send order. */
export function queuedUserMessages(input: {
  messages: readonly QueueMessage[]
  sessionID: string
  busy: boolean
  inFlightUserCreatedAt: number | null
  failedIDs: Record<string, true>
}): QueueMessage[] {
  return input.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) =>
      message.sessionID === input.sessionID &&
      !input.failedIDs[message.id] &&
      !isOptimisticID(message.id) &&
      awaitingTurn({
        role: message.role,
        createdAt: message.createdAt,
        busy: input.busy,
        inFlightUserCreatedAt: input.inFlightUserCreatedAt,
      }),
    )
    .sort((a, b) => (a.message.createdAt! - b.message.createdAt!) || a.index - b.index)
    .map(({ message }) => message)
}

/** Queued prompts lead the existing draft without blank separators. */
export function mergeQueuedText(queued: readonly string[], draft: string): string {
  return [...queued, draft].map((text) => text.trim()).filter(Boolean).join("\n\n")
}

/** A completed revert may only update the composer that initiated it. */
export function shouldApplyQueuedEdit(
  focused: boolean,
  routeSessionID: string | undefined,
  requestSessionID: string,
  currentSessionID: string | undefined,
): boolean {
  return focused && routeSessionID === requestSessionID && currentSessionID === requestSessionID
}
