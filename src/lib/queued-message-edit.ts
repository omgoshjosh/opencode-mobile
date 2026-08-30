import { awaitingTurn, isOptimisticID } from "./message-delivery.ts"

export interface QueueMessage {
  id: string
  sessionID: string
  role: string
  createdAt?: number
}

export interface QueuePart {
  type: string
  url?: unknown
  mime?: unknown
  filename?: string
}

export interface QueueAttachment {
  uri: string
  mime: string
  filename?: string
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

/** Refuse a revert unless every queued prompt can be faithfully recovered. */
export function recoverQueuedMessages(input: {
  messages: readonly QueueMessage[]
  parts: Record<string, QueuePart[] | undefined>
  draft: string
  extractText: (parts: QueuePart[]) => string
}): { ok: true; text: string; files: QueueAttachment[] } | { ok: false } {
  const texts: string[] = []
  const files: QueueAttachment[] = []
  for (const message of input.messages) {
    const parts = input.parts[message.id]
    if (!parts) return { ok: false }
    const messageFiles: QueueAttachment[] = []
    for (const part of parts) {
      if (part.type !== "file") continue
      if (typeof part.url !== "string" || !part.url.trim() || typeof part.mime !== "string" || !part.mime.trim()) return { ok: false }
      messageFiles.push({ uri: part.url, mime: part.mime, ...(part.filename ? { filename: part.filename } : {}) })
    }
    const text = input.extractText(parts).trim()
    if (!text && messageFiles.length === 0) return { ok: false }
    texts.push(text)
    files.push(...messageFiles)
  }
  return { ok: true, text: mergeQueuedText(texts, input.draft), files }
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
