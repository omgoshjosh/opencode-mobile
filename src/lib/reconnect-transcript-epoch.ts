/** Records the one active transcript a successful reconnect may reconcile. */
export function createReconnectTranscriptEpoch(reconnecting: boolean) {
  let attempted = false
  let sessionID: string | null = null

  return {
    reconcileOpen(openSessionID: string | null): string | null {
      if (!reconnecting || attempted) return null
      attempted = true
      sessionID = openSessionID
      return sessionID
    },
    shouldRefreshAfterIdle(id: string): boolean {
      return sessionID !== id
    },
  }
}
