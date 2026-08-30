export interface StreamPartIdentity {
  id: string
  messageID: string
  sessionID?: string
}

/** Part IDs are scoped to their owning message and session on the stream. */
export function streamPartKey(part: StreamPartIdentity): string {
  return `${part.sessionID ?? ""}\u0000${part.messageID}\u0000${part.id}`
}

/** Replacements retain their first arrival position while carrying latest data. */
export function queueStreamPart<T extends StreamPartIdentity>(queue: Map<string, T>, part: T): void {
  queue.set(streamPartKey(part), part)
}

export function canFlushVisiblePartStatus(visibleSessionID: string | undefined, activeTranscriptSessionID: string | null, sessionID: string): boolean {
  return visibleSessionID === sessionID && activeTranscriptSessionID === sessionID
}
