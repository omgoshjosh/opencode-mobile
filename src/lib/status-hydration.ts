export function canApplyStatusHydration(lifecycle: number, currentLifecycle: number, signal: AbortSignal) {
  return !signal.aborted && lifecycle === currentLifecycle
}
