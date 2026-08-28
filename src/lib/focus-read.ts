export interface FocusRead {
  signal: AbortSignal
  isCurrent: () => boolean
  dispose: () => void
}

export function createFocusReadCoordinator() {
  let active: FocusRead | null = null

  return {
    begin(parent?: AbortSignal): FocusRead {
      active?.dispose()
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      parent?.addEventListener("abort", onAbort)
      if (parent?.aborted) controller.abort()

      const read: FocusRead = {
        signal: controller.signal,
        isCurrent: () => active === read && !controller.signal.aborted,
        dispose: () => {
          controller.abort()
          parent?.removeEventListener("abort", onAbort)
          if (active === read) active = null
        },
      }
      active = read
      return read
    },
  }
}

export function canRefreshPending(signal: AbortSignal | undefined, currentSessionID: string | undefined, sessionID: string): boolean {
  return !signal?.aborted && currentSessionID === sessionID
}
