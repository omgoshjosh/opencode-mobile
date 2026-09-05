import { create } from "zustand"
import { useConnections } from "./connections"
import {
  useSessions,
  abortedSessions,
  optimisticSendingRevision,
  optimisticSendingRevisionSnapshot,
  cancelPendingStreamParts,
  flushPendingStreamParts,
  STREAM_PART_FLUSH_WINDOW_MS,
} from "./sessions"
import { canRefreshPending } from "../lib/focus-read"
import { send as notify } from "../lib/notifications"
import { sanitizeBody } from "../lib/notify-format"
import { notifySessionError } from "../lib/session-error-notification"
import { retryStatusLabel, statusFromPart } from "../lib/status-labels"
import { addBreadcrumb } from "../lib/sentry"
import { AnalyticsEvent, track } from "../lib/analytics"
import { recordSuccessfulSession } from "../lib/store-review"
import { isAuthError } from "../lib/api-error"
import { isSessionActuallyIdle } from "../lib/session-status-reconcile"
import { parseStatusCache, toStatusCache } from "../lib/status-cache"
import { nextSessionStatus, noteTextActivity, type SessionStatus } from "../lib/busy-lifecycle"
import { mergeStatusEvent, mergeStatusSnapshot } from "../lib/background-activity"
import { canFlushVisiblePartStatus, registerPartStatusFlusher } from "../lib/stream-part-batching"
import { canApplyFocusedStatusHydration, canApplyResyncIdle, canApplyStatusHydration, clearIdleSessionState, settledIdleSessionIDs } from "../lib/status-hydration"
import { createReconnectTranscriptCoordinator } from "../lib/reconnect-transcript"
import AsyncStorage from "@react-native-async-storage/async-storage"

// Last-known statuses, persisted eagerly so the sessions list renders real
// state at cold start instead of guessing "all idle". See src/lib/status-cache.ts.
const STATUS_CACHE_KEY = "opencode_session_status_cache"

function persistStatusCache(map: Record<string, { type: string }>) {
  AsyncStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(toStatusCache(map))).catch(() => {})
}

/** Restore at boot. Live values win: a status the stream already delivered is newer than the disk. */
export async function restoreStatusCache() {
  const raw = await AsyncStorage.getItem(STATUS_CACHE_KEY).catch(() => null)
  const cached = parseStatusCache(raw)
  if (Object.keys(cached).length === 0) return
  useEvents.setState((state) => ({ sessionStatus: { ...cached, ...state.sessionStatus } }))
}
import { isHealthy, shouldReconnectOnResume, shouldResetRetries, type TransportState } from "../lib/sse-liveness"
import { RECONCILE_MESSAGE_LIMIT, transcriptPageParams } from "../lib/message-page"
import type { Client, Part, Session, Message } from "../lib/sdk"

interface EventsState {
  /**
   * True only once the stream has actually delivered something. This used to
   * be set the moment a connect was *attempted*, so the green indicator
   * reflected an intention rather than a verified transport -- the app could
   * show connected over a socket that had never produced a byte.
   */
  connected: boolean
  /** Finer-grained view of the same thing; see src/lib/sse-liveness.ts. */
  transport: TransportState
  // Set when the last connection attempt failed with 401/403 — the server
  // rejected our credentials, not a transient network issue. The reconnect
  // loop stops retrying in this case (see connect()) since hammering a
  // fixed-credential auth failure forever just spams Sentry/battery with no
  // path to recovery (issue #76). Cleared on the next connect() attempt,
  // e.g. after the user fixes their credentials on the connection edit screen.
  authError: boolean
  reconnectAttempts: number
  lastDisconnectAt: number | null
  sessionStatus: Record<string, SessionStatus>
  terminalChildIDs: Record<string, true>
  statusText: Record<string, string>
  // Permissions & questions (pending per session)
  permissions: Record<
    string,
    Array<{
      id: string
      sessionID: string
      permission: string
      patterns: string[]
      metadata: Record<string, unknown>
      tool?: { messageID: string; callID: string }
    }>
  >
  questions: Record<
    string,
    Array<{
      id: string
      sessionID: string
      questions: Array<{
        question: string
        header: string
        options: Array<{ label: string; description: string }>
        multiple?: boolean
        custom?: boolean
      }>
      tool?: { messageID: string; callID: string }
    }>
  >

  connect: () => void
  disconnect: () => void
  /**
   * Called on foreground / network restoration. Reconnects only when the
   * transport is not already live and no attempt is in flight -- those two
   * signals often arrive together, and reconnecting twice would open duplicate
   * streams and double-handle every event.
   */
  resume: () => void
}

let controller: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let statusLifecycle = 0
const statusMutationRevisions = new Map<string, number>()
const pendingPartStatus = new Map<string, { text: string; receivedAt: number }>()
let partStatusTimer: ReturnType<typeof setTimeout> | null = null

export function flushPendingPartStatus() {
  if (partStatusTimer) {
    clearTimeout(partStatusTimer)
    partStatusTimer = null
  }
  if (pendingPartStatus.size === 0) return
  const updates = new Map(pendingPartStatus)
  pendingPartStatus.clear()
  useEvents.setState((state) => {
    let statusText = state.statusText
    let sessionStatus = state.sessionStatus
    let changed = false
    for (const [sessionID, update] of updates) {
      const sessions = useSessions.getState()
      // The session may have been replaced while this window was open. Never
      // let an old foreground timer paint status into a newly visible turn.
      if (!canFlushVisiblePartStatus(sessions.currentSession?.id, sessions.activeTranscriptSessionID, sessionID)) continue
      statusText = { ...statusText, [sessionID]: update.text }
      changed = true
      const next = noteTextActivity(sessionStatus[sessionID], update.receivedAt)
      if (next !== sessionStatus[sessionID]) sessionStatus = { ...sessionStatus, [sessionID]: next! }
    }
    return changed ? { statusText, sessionStatus } : state
  })
}

registerPartStatusFlusher(flushPendingPartStatus)

function flushPendingStreamWork() {
  flushPendingPartStatus()
  flushPendingStreamParts()
}

function cancelPendingStreamWork() {
  if (partStatusTimer) clearTimeout(partStatusTimer)
  partStatusTimer = null
  pendingPartStatus.clear()
  cancelPendingStreamParts()
}

function enqueuePartStatus(part: Part, receivedAt: number) {
  const sessionID = part.sessionID
  const sessions = useSessions.getState()
  // Background farm activity belongs in its preview/tool bookkeeping only;
  // it must not wake subscribers to foreground status state.
  if (!sessionID || sessions.currentSession?.id !== sessionID || sessions.activeTranscriptSessionID !== sessionID) return
  pendingPartStatus.set(sessionID, { text: statusFromPart(part), receivedAt })
  if (!partStatusTimer) partStatusTimer = setTimeout(flushPendingPartStatus, STREAM_PART_FLUSH_WINDOW_MS)
}

/** Single receipt path kept exportable so stream batching is deterministic in tests. */
export function receiveStreamPart(part: Part, receivedAt = Date.now()) {
  enqueuePartStatus(part, receivedAt)
  useSessions.getState().handleEvent({ type: "message.part.updated", properties: { part, receivedAt } } as any)
  if (part.type === "tool" && (part.state?.status === "completed" || part.state?.status === "error")) flushPendingStreamWork()
}

function changedStatusIDsSince(revisions: Map<string, number>, sendingRevisions: Map<string, number>) {
  const currentSendingRevisions = optimisticSendingRevisionSnapshot()
  return new Set(
    [...new Set([...revisions.keys(), ...statusMutationRevisions.keys(), ...sendingRevisions.keys(), ...currentSendingRevisions.keys()])].filter(
      (sessionID) =>
        revisions.get(sessionID) !== statusMutationRevisions.get(sessionID) ||
        sendingRevisions.get(sessionID) !== currentSendingRevisions.get(sessionID),
    ),
  )
}

function clearIdleSessions(sessionIDs: string[]) {
  if (sessionIDs.length === 0) return
  useEvents.setState((state) => ({
    statusText: sessionIDs.reduce((statusText, sessionID) => ({ ...statusText, [sessionID]: "" }), state.statusText),
  }))
  useSessions.setState((state) =>
    sessionIDs.reduce((next, sessionID) => {
      const cleared = clearIdleSessionState({
        sessionID,
        statusText: useEvents.getState().statusText,
        sending: next.sending,
        runningTools: next.runningTools,
      })
      return { ...next, sending: cleared.sending, runningTools: cleared.runningTools }
    }, state),
  )
}

export function clearDeletedSessionEventState(sessionIDs: string[]) {
  if (sessionIDs.length === 0) return
  const deleted = new Set(sessionIDs)
  for (const sessionID of deleted) {
    erroredSessions.delete(sessionID)
    abortedSessions.delete(sessionID)
    statusMutationRevisions.delete(sessionID)
    pendingPartStatus.delete(sessionID)
  }
  useEvents.setState((state) => ({
    sessionStatus: Object.fromEntries(Object.entries(state.sessionStatus).filter(([id]) => !deleted.has(id))),
    statusText: Object.fromEntries(Object.entries(state.statusText).filter(([id]) => !deleted.has(id))),
    terminalChildIDs: Object.fromEntries(Object.entries(state.terminalChildIDs).filter(([id]) => !deleted.has(id))),
    permissions: Object.fromEntries(Object.entries(state.permissions).filter(([id]) => !deleted.has(id))),
    questions: Object.fromEntries(Object.entries(state.questions).filter(([id]) => !deleted.has(id))),
  }))
  persistStatusCache(useEvents.getState().sessionStatus)
}

async function hydrateStatus(client: Client, lifecycle: number, signal: AbortSignal) {
  const revisions = new Map(statusMutationRevisions)
  const sendingRevisions = optimisticSendingRevisionSnapshot()
  try {
    const snapshot = await client.session.status(signal)
    if (!canApplyStatusHydration(lifecycle, statusLifecycle, signal) || !snapshot) return
    const changed = changedStatusIDsSince(revisions, sendingRevisions)
    let merged: Record<string, SessionStatus> = {}
    useEvents.setState((state) => {
      merged = mergeStatusSnapshot(state.sessionStatus, snapshot, changed, Date.now())
      return { sessionStatus: merged }
    })
    clearIdleSessions(settledIdleSessionIDs(merged, changed))
    persistStatusCache(merged)
  } catch (error) {
    if (signal.aborted) return
    console.warn("[Events] Failed to hydrate session status:", error)
  }
}

export async function refreshFocusedStatus(client: Client, sessionID: string, signal: AbortSignal) {
  const lifecycle = statusLifecycle
  const revision = statusMutationRevisions.get(sessionID) ?? 0
  const sendingRevision = optimisticSendingRevision(sessionID)
  try {
    const snapshot = await client.session.status(signal)
    if (!snapshot) return
    if (
      !canApplyFocusedStatusHydration({
        lifecycle,
        currentLifecycle: statusLifecycle,
        signal,
        currentSessionID: useSessions.getState().currentSession?.id,
        sessionID,
        revision,
        currentRevision: statusMutationRevisions.get(sessionID) ?? 0,
        sendingRevision,
        currentSendingRevision: optimisticSendingRevision(sessionID),
      })
    ) return
    const status = snapshot[sessionID] ?? { type: "idle" as const }
    let next: SessionStatus = status
    useEvents.setState((state) => {
      next = mergeStatusEvent(state.sessionStatus[sessionID], status)
      return { sessionStatus: { ...state.sessionStatus, [sessionID]: next } }
    })
    if (next.type === "idle") clearIdleSessions([sessionID])
    persistStatusCache(useEvents.getState().sessionStatus)
  } catch (error) {
    if (signal.aborted) return
    console.warn("[Events] Failed to refresh focused session status:", error)
  }
}

// Sessions that emitted session.error since they last went busy. SessionStatus
// has no error variant — an errored session still ends with a busy -> idle
// transition — so without this mark an errored run would count as a success
// toward the once-ever store review prompt.
const erroredSessions = new Set<string>()

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const
const PROLONGED_DISCONNECT_MS = 30_000

// Re-fetch pending permissions and questions from the server for a session.
// Called when entering a session to recover from missed SSE events or failed
// optimistic removals.
export async function refreshPending(client: Client, sessionID: string, signal?: AbortSignal) {
  if (!canRefreshPending(signal, useSessions.getState().currentSession?.id, sessionID)) return
  try {
    const [perms, questions] = await Promise.all([client.permission.list(signal), client.question.list(signal)])
    if (!canRefreshPending(signal, useSessions.getState().currentSession?.id, sessionID)) return
    const sessionPerms = (perms || []).filter((p: Record<string, unknown>) => p.sessionID === sessionID)
    const sessionQuestions = (questions || []).filter((q: Record<string, unknown>) => q.sessionID === sessionID)
    useEvents.setState((state) => ({
      permissions: { ...state.permissions, [sessionID]: sessionPerms as any },
      questions: { ...state.questions, [sessionID]: sessionQuestions as any },
    }))
  } catch (err) {
    if (signal?.aborted) return
    console.warn("[Events] Failed to refresh pending:", err)
  }
}

// Re-sync any session currently marked "busy" against the server after an
// SSE reconnect. sessionStatus/sending are SSE-driven and there is normally
// no other path to idle — if the server's busy -> idle `session.status`
// event fired while the network was down, SSE reconnect resumes the stream
// from "now" (it does not replay missed events), so without this the busy
// flag would never clear and the UI would show a stuck 'processing' spinner
// forever (issue #123).
//
// Only ever CLEARS a busy flag the server confirms is stale via
// isSessionActuallyIdle — it never marks a session busy, so it can't
// clobber a genuinely still-busy session. Also re-checks sessionStatus right
// before writing, so a real session.status event that lands while the fetch
// is in flight (e.g. the session went busy again) wins over this resync.
async function resyncBusySessions() {
  const busySessionIDs = Object.entries(useEvents.getState().sessionStatus)
    .filter(([, status]) => status.type === "busy")
    .map(([sessionID]) => sessionID)
  if (busySessionIDs.length === 0) return

  await Promise.all(
    busySessionIDs.map(async (sessionID) => {
      try {
        const sessionsState = useSessions.getState()
        const session =
          sessionsState.sessions.find((s) => s.id === sessionID) ??
          (sessionsState.currentSession?.id === sessionID ? sessionsState.currentSession : undefined)
        const connState = useConnections.getState()
        const client = session?.directory
          ? connState.clientForDirectory(session.directory) ?? connState.client
          : connState.client
        if (!client) return

        // isSessionActuallyIdle only inspects the final message, so one is
        // enough. This previously fetched the ENTIRE session — on every
        // reconnect, for every session this client believed was busy.
        const sendingRevision = optimisticSendingRevision(sessionID)
        const response = await client.session.messagesPage(sessionID, transcriptPageParams(RECONCILE_MESSAGE_LIMIT))
        const messages = response.items.map((m) => m.info)
        if (!isSessionActuallyIdle(messages)) return // server says still busy - leave it alone

        // A fresh session.status event may have landed on the SSE stream
        // while this fetch was in flight — that's authoritative, don't
        // stomp on it.
        if (useEvents.getState().sessionStatus[sessionID]?.type !== "busy") return
        if (!canApplyResyncIdle(sendingRevision, optimisticSendingRevision(sessionID))) return

        statusMutationRevisions.set(sessionID, (statusMutationRevisions.get(sessionID) ?? 0) + 1)
        useEvents.setState((state) => ({ sessionStatus: { ...state.sessionStatus, [sessionID]: { type: "idle" } } }))
        persistStatusCache(useEvents.getState().sessionStatus)
        clearIdleSessions([sessionID])
      } catch (err) {
        console.warn("[Events] Failed to resync session status for", sessionID, err)
      }
    }),
  )
}

// Reconcile the transcript of the session the user currently has open, after
// an SSE reconnect.
//
// resyncBusySessions() above is not enough on its own. It only considers
// sessions this client has marked "busy", and a client only learns a session
// is busy *from an SSE event*. If the stream was down while another client
// (CLI, TUI, another device) submitted a prompt, this client never saw the
// busy `session.status` event, so the session is still "idle" in its store,
// resyncBusySessions() finds nothing to do, and — because reconnect resumes
// the stream from "now" and does not replay missed events — the messages that
// arrived during the gap are never fetched. The open transcript then stays
// stale until the user navigates away and back, which is the reported
// cross-client staleness symptom.
//
// The reconnect coordinator fetches one bounded page for this active transcript,
// without discarding pagination or optimistic content.
function activeOpenSessionID(): string | null {
  const sessions = useSessions.getState()
  if (!sessions.currentSession || sessions.activeTranscriptSessionID !== sessions.currentSession.id) return null
  return sessions.currentSession.id
}

export const useEvents = create<EventsState>((set, get) => ({
  connected: false,
  transport: "idle" as TransportState,
  authError: false,
  reconnectAttempts: 0,
  lastDisconnectAt: null,
  sessionStatus: {},
  terminalChildIDs: {},
  statusText: {},
  permissions: {},
  questions: {},

  connect: () => {
    flushPendingStreamWork()
    controller?.abort()
    controller = null
    set({ transport: "idle" })
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const client = useConnections.getState().client
    if (!client) return

    // A reconnect's GET is its fresh baseline. Only mutations after this
    // socket begins may protect a newer local update.
    statusMutationRevisions.clear()
    const lifecycle = ++statusLifecycle

    controller = new AbortController()
    const currentController = controller
    // NOT connected yet -- only dialling. `connected` flips on the first
    // received event below, so the indicator cannot go green over a dead
    // stream.
    set({ transport: "connecting", authError: false })
    console.log("[SSE] Connecting to event stream...")
    addBreadcrumb({ category: "sse", message: "connecting" })

    // Run in background
    ;(async () => {
      let reconnectScheduled = false
      // True if this connect() call is resuming after a prior disconnect.
      // The busy-session resync used to run ONLY then, because a cold start
      // had an empty sessionStatus — that assumption died when the status
      // cache started restoring last-known state from disk. Now the resync
      // also runs on first liveness whenever any busy statuses exist, which
      // is exactly the set that can be stale (disk-restored or missed-idle).
      const isReconnect = get().reconnectAttempts > 0
      let resyncedAfterReconnect = false
      const reconnectTranscript = createReconnectTranscriptCoordinator({
        reconnecting: isReconnect,
        activeSessionID: activeOpenSessionID,
        reconcileOpen: () => void useSessions.getState().reconcileOpenMessages(),
        refreshAfterIdle: () => void useSessions.getState().refreshMessages(),
      })
      // Retry state resets on demonstrated liveness, not on a timer. The old
      // 10s timeout cleared the backoff whether or not anything had ever
      // arrived, so a silently-failing connection kept resetting its own
      // backoff and looked healthy.
      let receivedAnyEvent = false

      const scheduleReconnect = (reason: unknown) => {
        if (reconnectScheduled || currentController.signal.aborted) return
        flushPendingStreamWork()
        reconnectScheduled = true
        const state = get()
        const reconnectAttempts = state.reconnectAttempts + 1
        const lastDisconnectAt = state.lastDisconnectAt ?? Date.now()
        const disconnectedFor = Date.now() - lastDisconnectAt
        set({ connected: false, transport: "idle", reconnectAttempts, lastDisconnectAt })

        if (disconnectedFor >= PROLONGED_DISCONNECT_MS) {
          notify({
            category: "connection",
            title: "Connection interrupted",
            body: sanitizeBody(undefined, "Trying to reconnect to your server"),
            sessionId: "",
            dedupeKey: "sse-prolonged-disconnect",
            dedupeCooldownMs: 60_000,
          })
        }

        const baseDelay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts - 1, RECONNECT_DELAYS_MS.length - 1)]
        const jitteredDelay = Math.min(15_000, Math.round(baseDelay * (0.75 + Math.random() * 0.5)))
        console.warn(`[SSE] Connection lost, reconnecting in ${jitteredDelay}ms:`, reason)
        addBreadcrumb({
          category: "sse",
          level: "warning",
          message: "reconnect scheduled",
          data: { attempt: reconnectAttempts, delayMs: jitteredDelay, reason: String(reason).slice(0, 200) },
        })
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          get().connect()
        }, jitteredDelay)
      }

      try {
        for await (const event of client.global.events(currentController.signal)) {
          if (currentController.signal.aborted) break

          // The stream is genuinely live again (we're actually receiving
          // data, not just optimistically marked "connected") — resync once
          // per reconnect, not on every event.
          const hasBusyStatuses = Object.values(get().sessionStatus).some((s) => s.type === "busy")
          if ((isReconnect || hasBusyStatuses) && !resyncedAfterReconnect) {
            resyncedAfterReconnect = true
            void resyncBusySessions()
          }
          reconnectTranscript.onEvent()

          if (!receivedAnyEvent) {
            receivedAnyEvent = true
            if (shouldResetRetries({ receivedEvent: true })) {
              set({ connected: true, transport: "live", reconnectAttempts: 0, lastDisconnectAt: null })
            }
            void hydrateStatus(client, lifecycle, currentController.signal)
            // One complete global snapshot per demonstrated-live lifecycle
            // removes sessions deleted while SSE was down.
            void useSessions.getState().reconcileSessions(lifecycle).then(clearDeletedSessionEventState)
          }

          const payload = (event as any).payload || event
          const type = payload.type as string
          const props = payload.properties || {}

          switch (type) {
            case "session.status": {
              const sessionID = props.sessionID as string
              const status = props.status as SessionStatus
              if (!sessionID) break
              if (status.type === "idle") flushPendingStreamWork()
              statusMutationRevisions.set(sessionID, (statusMutationRevisions.get(sessionID) ?? 0) + 1)

              // Detect busy → idle transition for completion notification
              const previous = get().sessionStatus[sessionID]
              const completed = previous?.type === "busy" && status.type === "idle"

              // A new run starts — forget any error/abort from the previous one
              if (status.type === "busy") {
                erroredSessions.delete(sessionID)
                abortedSessions.delete(sessionID)
              }
              const next = nextSessionStatus(previous, mergeStatusEvent(previous, status), Date.now())
              set((state) => ({ sessionStatus: { ...state.sessionStatus, [sessionID]: next } }))
              if (status.type === "retry" && previous?.type !== "retry") {
                notify({ category: "errors", title: "Retrying", body: retryStatusLabel(status), sessionId: sessionID })
              }
              // Eager, on every transition: the sessions list must be able to
              // render last-known truth at next cold start.
              persistStatusCache(get().sessionStatus)

              // SSE is the source of truth — update sending state unconditionally
              if (status.type === "idle") {
                clearIdleSessions([sessionID])
                // Refresh messages if this is the session the user is viewing
                const sessions = useSessions.getState()
                if (
                  sessions.activeTranscriptSessionID === sessionID &&
                  sessions.currentSession?.id === sessionID
                ) {
                  reconnectTranscript.onIdle(sessionID, true)
                }
              }

              if (completed) {
                // A user-cancelled run still ends busy -> idle; don't count it
                // as a received response or a review-worthy success.
                const aborted = abortedSessions.has(sessionID)
                if (!aborted) track(AnalyticsEvent.ResponseReceived)
                // Only notify "Task completed" for a genuine completion — a
                // user-cancelled run didn't complete, and an errored run
                // already fired its own "Session error" notification (session.error
                // doesn't touch sessionStatus, so an errored session still lands
                // here via busy→idle). Without this guard the user gets a
                // misleading — or duplicate, contradictory — completion push.
                if (!aborted && !erroredSessions.has(sessionID)) {
                  const match = useSessions.getState().sessions.find((s) => s.id === sessionID)
                  notify({
                    category: "completed",
                    title: "Task completed",
                    body: sanitizeBody(match?.title, "Session finished processing"),
                    sessionId: sessionID,
                  })
                }
                // Genuinely positive moment — count it toward the one-time
                // store review prompt, but only if this run never errored
                // (session.error doesn't touch sessionStatus, so an errored
                // session still lands here via busy -> idle) and wasn't aborted.
                if (!aborted && !erroredSessions.has(sessionID)) void recordSuccessfulSession()
              }
              break
            }

            case "message.updated": {
              const info = props.info as Message | undefined
              if (!info) break
              flushPendingStreamWork()
              useSessions.getState().handleEvent({ type, properties: { info } } as any)
              break
            }

            case "message.part.updated": {
              const part = props.part as Part | undefined
              if (!part) break
              const receivedAt = Date.now()
              receiveStreamPart(part, receivedAt)

              if (part.type === "tool" && part.tool === "task") {
                const metadata = part.state?.metadata as { sessionId?: unknown } | undefined
                const childID = typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined
                if (childID) {
                  const terminal = part.state?.status === "completed" || part.state?.status === "error"
                  set((state) => ({
                    terminalChildIDs: terminal
                      ? { ...state.terminalChildIDs, [childID]: true }
                      : Object.fromEntries(Object.entries(state.terminalChildIDs).filter(([id]) => id !== childID)),
                  }))
                }
              }

              break
            }

            case "session.updated": {
              const info = props.info as Session | undefined
              if (!info) break
              useSessions.getState().handleEvent({ type, properties: { info } } as any)
              break
            }

            case "session.created": {
              const info = props.info as Session | undefined
              if (!info) break
              useSessions.getState().handleEvent({ type, properties: { info } } as any)
              break
            }

            case "session.deleted": {
              const sessionID = (props.sessionID || props.info?.id) as string | undefined
              if (!sessionID) break
              useSessions.getState().handleEvent({ type, properties: { sessionID } } as any)
              clearDeletedSessionEventState([sessionID])
              break
            }

            case "session.error": {
              const error = props.error as { message?: string } | undefined
              const sessionID = props.sessionID as string
              if (!sessionID) break
              flushPendingStreamWork()
              // Mark so the eventual busy -> idle transition is not counted
              // as a success for the store review prompt
              erroredSessions.add(sessionID)
              // Clear sending state unconditionally — SSE is truth
              useSessions.setState((state) => ({
                sending: { ...state.sending, [sessionID]: false },
                // Surface error only if user is viewing this session
                  ...(state.activeTranscriptSessionID === sessionID && state.currentSession?.id === sessionID
                    ? { error: error?.message || "Session error occurred" }
                    : {}),
                }))
              const latestSessions = useSessions.getState()
              if (
                latestSessions.activeTranscriptSessionID === sessionID &&
                latestSessions.currentSession?.id === sessionID
              ) {
                latestSessions.refreshMessages()
              }
              notifySessionError(notify, sessionID, error?.message)
              break
            }

            case "permission.asked": {
              const req = props as any
              if (!req.id || !req.sessionID) break
              const existing = get().permissions[req.sessionID] || []
              if (existing.some((item) => item.id === req.id)) break
              set((state) => ({
                permissions: {
                  ...state.permissions,
                  [req.sessionID]: [...(state.permissions[req.sessionID] || []), req],
                },
              }))
              notify({
                category: "permissions",
                title: "Agent needs approval",
                body: sanitizeBody(
                  req.permission
                    ? req.patterns?.length
                      ? `${req.permission}: ${req.patterns.join(", ")}`
                      : req.permission
                    : req.patterns?.join(", "),
                  "A tool needs your approval",
                ),
                sessionId: req.sessionID,
                dedupeKey: `perm-${req.id}`,
                dedupeCooldownMs: 60_000,
              })
              break
            }

            case "permission.replied": {
              const sessionID = props.sessionID as string
              const requestID = props.requestID as string
              if (!sessionID || !requestID) break
              set((state) => ({
                permissions: {
                  ...state.permissions,
                  [sessionID]: (state.permissions[sessionID] || []).filter((p) => p.id !== requestID),
                },
              }))
              break
            }

            case "question.asked": {
              const req = props as any
              if (!req.id || !req.sessionID) break
              const existing = get().questions[req.sessionID] || []
              if (existing.some((item) => item.id === req.id)) break
              set((state) => ({
                questions: {
                  ...state.questions,
                  [req.sessionID]: [...(state.questions[req.sessionID] || []), req],
                },
              }))
              notify({
                category: "questions",
                title: req.questions?.[0]?.header || "Input needed",
                body: sanitizeBody(req.questions?.[0]?.question, "The assistant has a question"),
                sessionId: req.sessionID,
                dedupeKey: `question-${req.id}`,
                dedupeCooldownMs: 60_000,
              })
              break
            }

            case "question.replied":
            case "question.rejected": {
              const sessionID = props.sessionID as string
              const requestID = props.requestID as string
              if (!sessionID || !requestID) break
              set((state) => ({
                questions: {
                  ...state.questions,
                  [sessionID]: (state.questions[sessionID] || []).filter((q) => q.id !== requestID),
                },
              }))
              break
            }
          }
        }

        scheduleReconnect(new Error("Event stream closed"))
      } catch (err) {
        if (isAuthError(err) && !currentController.signal.aborted) {
          // Bad credentials, not a transient failure — retrying forever just
          // spams Sentry and drains the battery with zero path to recovery
          // (issue #76: 309 events / 65 users). Stop and surface a distinct
          // state instead; the sessions screen offers a link to fix
          // credentials, which reconnects via connect() once saved.
          console.warn("[SSE] Authentication failed — stopping reconnect loop:", err)
          addBreadcrumb({
            category: "sse",
            level: "error",
            message: "auth error - stopped retrying",
            data: { status: err.status },
          })
          track(AnalyticsEvent.ConnectionFailed, { source: "sse", error_class: "unauthorized" })
          set({ connected: false, transport: "idle", authError: true })
        } else {
          scheduleReconnect(err)
        }
      } finally {
        if (currentController.signal.aborted) {
          console.log("[SSE] Disconnected (aborted)")
        }
      }
    })()
  },

  resume: () => {
    const { transport } = get()
    // Foregrounding can expose a transcript gap even when iOS kept the socket
    // live, so this is deliberately independent of whether resume reconnects.
    void useSessions.getState().reconcileOpenMessages()
    // reconnectTimer set means a retry is already scheduled; controller set
    // with a non-aborted signal means one is dialling right now.
    const attemptInFlight = reconnectTimer !== null || (controller !== null && !controller.signal.aborted)
    if (!shouldReconnectOnResume({ transport, attemptInFlight })) return
    console.log("[SSE] resume -> reconnecting")
    addBreadcrumb({ category: "sse", message: "resume reconnect" })
    get().connect()
  },

  disconnect: () => {
    console.log("[SSE] Disconnecting")
    addBreadcrumb({ category: "sse", message: "disconnected" })
    flushPendingStreamWork()
    cancelPendingStreamWork()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    // Invalidate a GET even when its transport ignores abort and resolves late.
    statusLifecycle++
    controller?.abort()
    controller = null
    erroredSessions.clear()
    abortedSessions.clear()
    statusMutationRevisions.clear()
    set({
      connected: false,
      authError: false,
      reconnectAttempts: 0,
      lastDisconnectAt: null,
      sessionStatus: {},
      terminalChildIDs: {},
      statusText: {},
      permissions: {},
      questions: {},
    })
  },
}))
