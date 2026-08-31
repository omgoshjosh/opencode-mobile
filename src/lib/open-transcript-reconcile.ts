/** Coalesce reconnect and live-event reconciliation for one open transcript. */
export function createOpenTranscriptReconciler() {
  const pending = new Map<string, Promise<void>>()

  return {
    run(sessionID: string, work: () => Promise<void>): Promise<void> {
      const existing = pending.get(sessionID)
      if (existing) return existing

      const request = work().finally(() => pending.delete(sessionID))
      pending.set(sessionID, request)
      return request
    },
  }
}
