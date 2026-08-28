export function nextActiveTranscript(current: string | null, sessionID: string, active: boolean): string | null {
  if (active) return sessionID
  return current === sessionID ? null : current
}

export function isTranscriptActive(activeSessionID: string | null, currentSessionID?: string): boolean {
  return !!activeSessionID && activeSessionID === currentSessionID
}

export function shouldApplyTranscriptSnapshot(startRevision: number, currentRevision: number): boolean {
  return startRevision === currentRevision
}
