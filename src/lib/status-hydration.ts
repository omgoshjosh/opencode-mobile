import { clearSessionTools, type RunningToolMap } from "./running-tools.ts"

export function canApplyStatusHydration(lifecycle: number, currentLifecycle: number, signal: AbortSignal) {
  return !signal.aborted && lifecycle === currentLifecycle
}

export function canApplyFocusedStatusHydration({
  lifecycle,
  currentLifecycle,
  signal,
  currentSessionID,
  sessionID,
  revision,
  currentRevision,
}: {
  lifecycle: number
  currentLifecycle: number
  signal: AbortSignal
  currentSessionID: string | undefined
  sessionID: string
  revision: number
  currentRevision: number
}) {
  return (
    canApplyStatusHydration(lifecycle, currentLifecycle, signal) &&
    currentSessionID === sessionID &&
    revision === currentRevision
  )
}

export function clearIdleSessionState({
  sessionID,
  statusText,
  sending,
  runningTools,
}: {
  sessionID: string
  statusText: Record<string, string>
  sending: Record<string, boolean>
  runningTools: RunningToolMap
}) {
  return {
    statusText: { ...statusText, [sessionID]: "" },
    sending: { ...sending, [sessionID]: false },
    runningTools: clearSessionTools(runningTools, sessionID),
  }
}
