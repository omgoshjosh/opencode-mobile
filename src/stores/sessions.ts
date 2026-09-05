import { create } from "zustand"
import { ApiError, type Session, type Message, type Part, type Event, type MessageWithParts, type Client } from "../lib/sdk"
import { useConnections } from "./connections"
import { useSettings } from "./settings"
import { addBreadcrumb } from "../lib/sentry"
import { AnalyticsEvent, track } from "../lib/analytics"
import { extractPromptFromParts, type PromptFromParts } from "../lib/prompt-from-parts"
import { mergeIncomingMessage } from "../lib/message-merge"
import { isColdSessionLoad, isLiveEventForSession } from "../lib/session-load-reconcile"
import {
  mergeOlderPage,
  mergeOlderParts,
  mergeRefreshWindow,
  oldestLoadedMessageID,
  REFRESH_PAGE_CAP,
  refreshPageSampleLatency,
  prependRefreshPage,
  shouldFetchRefreshPage,
  transcriptPageParams,
} from "../lib/message-page"
import { canRenderFromCache, dropTranscript, getTranscript, putTranscript, type TranscriptCache } from "../lib/transcript-cache"
import { dropPreview, parsePreviewMap, previewFromParts, previewText, putPreview, type PreviewMap } from "../lib/session-preview"
import { markViewed, parseLastViewed, type LastViewedMap } from "../lib/session-attention"
import {
  applyServerState,
  dropReadState,
  isMarkedUnread,
  optimisticMarkRead,
  optimisticMarkUnread,
  parseReadState,
  revisionFor,
  serializeReadState,
  type ReadStateMap,
  type ServerSessionState,
} from "../lib/session-read-state"
import { serializeSnapshot, parseSnapshot } from "../lib/list-freshness"
import { trackToolPart, clearSessionTools, type RunningToolMap } from "../lib/running-tools"
import { trackWakePart, type PendingWakeMap } from "../lib/pending-wakes"
import { toolCallTitle } from "../lib/tool-titles"
import { createFocusReadCoordinator } from "../lib/focus-read"
import { isTranscriptActive, nextActiveTranscript, shouldApplyTranscriptSnapshot } from "../lib/transcript-focus"
import { createOpenTranscriptReconciler } from "../lib/open-transcript-reconcile"
import { mergeReconciledTranscript } from "../lib/reconnect-transcript"
import { isHiddenSyntheticUserMessage } from "../lib/transcript-visibility"
import { warmSessionFor } from "../lib/warm-session"
import { flushPendingPartStatusForTranscriptBoundary, streamPartKey } from "../lib/stream-part-batching"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Alert } from "react-native"
import i18n from "../lib/i18n/config"

// Helper to convert API response to our internal format
function parseMessages(response: MessageWithParts[]): { messages: Message[]; parts: Record<string, Part[]> } {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}

  for (const item of response || []) {
    if (isHiddenSyntheticUserMessage(item.info, item.parts)) continue
    messages.push(item.info)
    parts[item.info.id] = item.parts || []
  }

  return { messages, parts }
}

// Holds only session ids and timestamps -- no message text, titles or tool
// output. See the allowlist in src/lib/persisted-keys.test.ts.
const LAST_VIEWED_KEY = "session_last_viewed"

// Cache of the server's unread marks — ids, timestamps and revisions only.
// Purely so a cold start paints marks before hydration returns; the server
// overwrites it on every event. Same allowlist as above.
const READ_STATE_KEY = "session_read_state"

// Last-known preview lines, persisted eagerly for cold-start rendering.
// Bounded by MAX_TRACKED_PREVIEWS via putPreview, so the write stays small.
const PREVIEWS_KEY = "session_previews"

// Text deltas arrive roughly per-token while any session on the farm streams,
// and each one used to serialize the WHOLE preview map and write it to disk —
// a hidden per-token JSON.stringify + AsyncStorage tax on the JS thread
// (found in the slowdown audit). Trailing debounce instead: disk gets the
// latest map once per window. Previews are a cold-start convenience, not a
// journal — losing the last 2s on a process kill costs one stale preview
// line, which the stream corrects on next launch.
const PREVIEWS_PERSIST_DELAY_MS = 2_000
let previewsPersistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersistPreviews() {
  if (previewsPersistTimer) return
  previewsPersistTimer = setTimeout(() => {
    previewsPersistTimer = null
    // Read at fire time, not schedule time: the map has moved on since.
    AsyncStorage.setItem(PREVIEWS_KEY, JSON.stringify(useSessions.getState().previews)).catch(() => {})
  }, PREVIEWS_PERSIST_DELAY_MS)
}

// Last successful session list, for instant cold-start paint on a slow
// backend. Session METADATA only (ids/titles/timestamps/directories — trimmed
// and bounded in src/lib/list-freshness.ts); rows hydrated from it carry a
// visible "as of" label until a live fetch confirms them.
const SESSIONS_SNAPSHOT_KEY = "sessions_snapshot"

function persistSessionsSnapshot(sessions: Session[]) {
  AsyncStorage.setItem(SESSIONS_SNAPSHOT_KEY, serializeSnapshot(sessions, Date.now())).catch(() => {})
}

// Unbatched, unlike previews: marks change on a tap or an SSE event, not per
// streamed token, so there is no write storm to coalesce.
function persistReadState(readState: ReadStateMap) {
  AsyncStorage.setItem(READ_STATE_KEY, serializeReadState(readState)).catch(() => {})
}

/** putPreview + scheduled persist in one step, for use inside set() updaters. */
function persistedPutPreview(previews: PreviewMap, sessionID: string, seed: { text: string; at: number }): PreviewMap {
  const next = putPreview(previews, sessionID, seed)
  schedulePersistPreviews()
  return next
}

function pageSize(): number {
  return useSettings.getState().pageSize
}

interface SessionsState {
  sessions: Session[]
  currentSession: Session | null
  // Selection survives native-stack navigation; visibility does not.
  activeTranscriptSessionID: string | null
  messages: Message[]
  parts: Record<string, Part[]>
  // Message IDs whose send failed. Kept so the transcript can show the
  // message as failed instead of silently deleting what the user typed.
  failedMessageIDs: Record<string, true>
  isLoading: boolean
  // Per-session optimistic sending flag — bridging gap between user tap and SSE busy
  sending: Record<string, boolean>
  loadingMore: boolean
  hasMore: boolean
  // Opaque continuation token for the open session's transcript. Absent once
  // the server reports no more history. See src/lib/message-page.ts.
  nextCursor?: string
  // Recently-viewed transcripts, so switching back doesn't cost a cold fetch.
  // Bounded in both dimensions — see src/lib/transcript-cache.ts.
  transcriptCache: TranscriptCache
  // Last line of text seen per session, harvested from the global SSE stream.
  // A label, not a cache — see src/lib/session-preview.ts.
  previews: PreviewMap
  // In-flight tool calls per session, farm-wide, from the global stream.
  // Feeds the hub's waiting-on panel. Bounded — see src/lib/running-tools.ts.
  runningTools: RunningToolMap
  // Scheduled wakeups per session (client-derived expectation until the
  // server's pendingWake field ships) — see src/lib/pending-wakes.ts.
  pendingWakes: PendingWakeMap
  // sessionID -> when this client last opened it. Turns "session was updated"
  // into "updated since you looked", which is what separates a finished run
  // you still need to read from one you're done with.
  lastViewed: LastViewedMap
  // Server-owned "leave this unread" marks, mirrored locally so a row can
  // render before hydration lands. The server is authoritative — this is a
  // cache plus an optimistic overlay, never the source of truth.
  readState: ReadStateMap
  // False once a connection has answered 404 for the read-state route: the
  // daemon predates it. Drives hiding the menu item rather than offering an
  // action that can only fail.
  readStateSupported: boolean
  error: string | null
  // Where the rows in `sessions` came from and when — the inputs to the
  // list's staleness banner (src/lib/list-freshness.ts). The UI must be able
  // to say "showing sessions from 20m ago" instead of presenting disk-cached
  // or refresh-failed data as current.
  listSource: "network" | "snapshot" | null
  listAsOf: number | null
  listLoadFailed: boolean

  // Actions
  loadSessions: () => Promise<void>
  loadSessionChildren: (sessionID: string) => Promise<void>
  reconcileSessions: (lifecycle: number) => Promise<string[]>
  removeSession: (sessionID: string) => void
  loadLastViewed: () => Promise<void>
  /** Send a session back to the unread queue. Reverts and alerts on failure. */
  markUnread: (sessionID: string) => Promise<void>
  /** Clear the mark. Fire-and-forget: never throws, never blocks opening. */
  markRead: (sessionID: string) => void
  /** Fold a server state in — from a PATCH echo, SSE, or hydration. */
  applyServerReadState: (state: ServerSessionState) => void
  selectSession: (sessionID: string, directory?: string, signal?: AbortSignal) => Promise<boolean>
  loadOlderMessages: () => Promise<void>
  createSession: (title?: string) => Promise<Session | null>
  deleteSession: (sessionID: string) => Promise<void>
  sendMessage: (
    text: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    files?: Array<{ uri: string; mime: string; filename?: string; base64?: string }>,
    variant?: string,
  ) => Promise<void>
  abortSession: () => Promise<void>
  refreshMessages: (signal?: AbortSignal) => Promise<void>
  reconcileOpenMessages: () => Promise<void>
  setTranscriptActive: (sessionID: string, active: boolean) => void

  // Revert (edit sent message) / unrevert (undo the pending revert)
  revertToMessage: (messageID: string) => Promise<RevertResult>
  unrevertSession: () => Promise<boolean>

  // Event handling
  handleEvent: (event: Event) => void
  /** Idle is authoritative — completions can be lost across reconnects, so
   *  events.ts calls this on busy→idle to drop any running-tool stragglers. */
  clearRunningTools: (sessionID: string) => void
}

export type RevertResult = ({ ok: true } & PromptFromParts) | { ok: false; reason: "unsupported" | "auth" | "error" }

// Sessions the user aborted since they last went busy. Mirrors events.ts's
// erroredSessions: SessionStatus has no "aborted" variant — an aborted run
// still ends with a busy -> idle transition — so without this mark a
// user-cancelled run would count as response_received in analytics and as a
// success toward the store review prompt. events.ts (which already imports
// this module) clears entries on busy and checks them on busy -> idle.
export const abortedSessions = new Set<string>()
const optimisticSendingRevisions = new Map<string, number>()

export function optimisticSendingRevision(sessionID: string): number {
  return optimisticSendingRevisions.get(sessionID) ?? 0
}

export function optimisticSendingRevisionSnapshot(): Map<string, number> {
  return new Map(optimisticSendingRevisions)
}

// Same guard for loadSessions: the two-phase load below commits twice, and a
// pull-to-refresh (or filter flip) issued mid-flight must not have an older
// call's phase-2 result land on top of a newer call's rows.
let listLoadSeq = 0
let sessionReconcileLifecycle = 0
const sessionMembershipRevisions = new Map<string, number>()
const deletedSessionIDs = new Set<string>()

// Monotonic token guarding selectSession against out-of-order resolution: a
// slow fetch for a session the user has already navigated away from must not
// overwrite the messages/currentSession of a newer selection. Each call takes
// the next value and only commits its result if still the latest.
let selectSeq = 0
const focusReads = createFocusReadCoordinator()
const transcriptRevisions = new Map<string, number>()
const openTranscriptReconciler = createOpenTranscriptReconciler()
export const STREAM_PART_FLUSH_WINDOW_MS = 100

// A stream can deliver one event per token. Keep only the newest version of a
// part while retaining the insertion order of distinct parts in this window.
const pendingParts = new Map<string, { part: Part; receivedAt: number }>()
const pendingTranscriptGenerations = new Map<string, number>()
let streamPartTimer: ReturnType<typeof setTimeout> | null = null
let selectingSessionID: string | null = null

function transcriptRevision(sessionID: string): number {
  return transcriptRevisions.get(sessionID) ?? 0
}

function bumpTranscriptRevision(sessionID: string) {
  transcriptRevisions.set(sessionID, transcriptRevision(sessionID) + 1)
}

function flushStreamPartUpdates() {
  if (streamPartTimer) {
    clearTimeout(streamPartTimer)
    streamPartTimer = null
  }
  if (pendingParts.size === 0) return

  const updates = [...pendingParts.entries()]
  pendingParts.clear()
  const generations = new Map(pendingTranscriptGenerations)
  pendingTranscriptGenerations.clear()
  useSessions.setState((state) => {
    let previews = state.previews
    let runningTools = state.runningTools
    let pendingWakes = state.pendingWakes
    let messages = state.messages
    let parts = state.parts
    let transcriptChanged = false
    for (const [key, { part, receivedAt }] of updates) {
      // A destination transcript is not installed until selectSession's GET
      // resolves. Keep its live events instead of consuming them against the
      // outgoing transcript while that request is in flight.
      if (selectingSessionID === part.sessionID && state.currentSession?.id !== part.sessionID) {
        pendingParts.set(key, { part, receivedAt })
        continue
      }
      const message = state.messages.find((item) => item.id === part.messageID)
      if (message && isHiddenSyntheticUserMessage(message, [...(parts[part.messageID] ?? []), part])) {
        if (!transcriptChanged) parts = { ...parts }
        delete parts[part.messageID]
        messages = messages.filter((item) => item.id !== part.messageID)
        transcriptChanged = true
        continue
      }
      if (part.sessionID && part.type === "text") {
        const text = previewText(part.text)
        if (text) previews = persistedPutPreview(previews, part.sessionID, { text, at: part.time?.start ?? receivedAt })
      }
      if (part.sessionID && part.type === "tool") {
        runningTools = trackToolPart(runningTools, part, toolCallTitle(part), receivedAt)
        pendingWakes = trackWakePart(pendingWakes, part, receivedAt)
      }
      const sessionID = part.sessionID
      if (
        !sessionID ||
        state.currentSession?.id !== sessionID ||
        !isTranscriptActive(state.activeTranscriptSessionID, sessionID) ||
        generations.get(sessionID) !== transcriptRevision(sessionID)
      ) continue
      const messageParts = parts[part.messageID] || []
      const index = messageParts.findIndex((item) => item.id === part.id)
      const next = index === -1 ? [...messageParts, part] : messageParts.map((item, i) => (i === index ? part : item))
      if (next === messageParts) continue
      if (!transcriptChanged) parts = { ...parts }
      parts[part.messageID] = next
      transcriptChanged = true
    }
    return {
      ...(previews !== state.previews ? { previews } : null),
      ...(runningTools !== state.runningTools ? { runningTools } : null),
      ...(pendingWakes !== state.pendingWakes ? { pendingWakes } : null),
      ...(transcriptChanged ? { messages, parts, isLoading: false } : null),
    }
  })
}

export function flushPendingStreamParts() {
  flushStreamPartUpdates()
}

export function cancelPendingStreamParts() {
  if (streamPartTimer) clearTimeout(streamPartTimer)
  streamPartTimer = null
  pendingParts.clear()
  pendingTranscriptGenerations.clear()
}

export function enqueueStreamPart(part: Part, receivedAt = Date.now()) {
  const state = useSessions.getState()
  const sessionID = part.sessionID
  if (
    sessionID &&
    isTranscriptActive(state.activeTranscriptSessionID, sessionID) &&
    (state.currentSession?.id === sessionID || selectingSessionID === sessionID)
  ) {
    bumpTranscriptRevision(sessionID)
    pendingTranscriptGenerations.set(sessionID, transcriptRevision(sessionID))
  }
  pendingParts.set(streamPartKey(part), { part, receivedAt })
  if (!streamPartTimer) streamPartTimer = setTimeout(flushStreamPartUpdates, STREAM_PART_FLUSH_WINDOW_MS)
}

// Connections whose read state has already been hydrated. Hydration is a
// per-connection capability probe plus a bulk read; repeating it on every
// pull-to-refresh would cost a request per directory for data SSE already
// keeps current.
const hydratedReadStateConnections = new Set<string>()

/**
 * Best-effort bulk read of the unread marks for the loaded roots.
 *
 * One request per distinct directory, because the card-state route is scoped to
 * a project. Entirely optional: a 404 means an old daemon (and disables the
 * feature for this connection), and any other failure just leaves the cached
 * marks in place until SSE or the next connection corrects them.
 */
async function hydrateReadState(connectionID: string | undefined, sessions: Session[]) {
  const key = connectionID ?? "default"
  if (hydratedReadStateConnections.has(key)) return
  hydratedReadStateConnections.add(key)

  const store = useSessions.getState()
  const directories = [...new Set(sessions.map((session) => session.directory).filter((d): d is string => Boolean(d)))]

  for (const directory of directories) {
    if (!useSessions.getState().readStateSupported) return
    const client = clientFor(directory)
    if (!client) continue
    try {
      const page = await client.sessionState.hydrate(directory)
      if (!page) {
        useSessions.setState({ readStateSupported: false })
        return
      }
      for (const state of Object.values(page.sessionUiState ?? {})) {
        // The card route names the revision `revision`; the update route and
        // the SSE event both call the same number `timeUpdated`.
        store.applyServerReadState({
          sessionID: state.sessionID,
          markedUnreadAt: state.markedUnreadAt,
          timeUpdated: state.revision,
        })
      }
    } catch {
      // Opportunistic. Cached marks stand.
    }
  }
}

// Reset when the active connection changes so a reconnect re-probes rather
// than trusting a capability answer from a different server.
export function resetReadStateHydration() {
  hydratedReadStateConnections.clear()
}

// Get the right client for a session's directory
function clientFor(directory?: string): Client | null {
  const connState = useConnections.getState()
  if (!directory) return connState.client
  const connDir = connState.activeConnection?.directory
  if (directory !== connDir) return connState.clientForDirectory(directory)
  return connState.client
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  currentSession: null,
  activeTranscriptSessionID: null,
  messages: [],
  parts: {},
  failedMessageIDs: {},
  isLoading: false,
  sending: {},
  loadingMore: false,
  hasMore: false,
  transcriptCache: {},
  previews: {},
  lastViewed: {},
  readState: {},
  readStateSupported: true,
  runningTools: {},
  pendingWakes: {},
  error: null,
  listSource: null,
  listAsOf: null,
  listLoadFailed: false,

  setTranscriptActive: (sessionID, active) => {
    if (nextActiveTranscript(get().activeTranscriptSessionID, sessionID, active) !== get().activeTranscriptSessionID) {
      flushPendingPartStatusForTranscriptBoundary()
      flushStreamPartUpdates()
      bumpTranscriptRevision(sessionID)
    }
    set((state) => ({
      activeTranscriptSessionID: nextActiveTranscript(state.activeTranscriptSessionID, sessionID, active),
    }))
  },

  loadLastViewed: async () => {
    try {
      set({ lastViewed: parseLastViewed(await AsyncStorage.getItem(LAST_VIEWED_KEY)) })
    } catch {
      // Read state is a convenience; failing to restore it must not block the
      // session list from rendering.
    }
    // Unread marks ride the same boot path, for the same reason: the row should
    // paint its mark from disk rather than flicker read until hydration lands.
    // Live entries win — a mark applied this session is newer than the cache.
    try {
      const cached = parseReadState(await AsyncStorage.getItem(READ_STATE_KEY))
      if (Object.keys(cached).length > 0) {
        set((state) => ({ readState: { ...cached, ...state.readState } }))
      }
    } catch {
      // Read state is a convenience; failing to restore it must not block the
      // session list from rendering.
    }
    // Previews ride the same boot path: last-known "what is this session
    // talking about" lines render immediately instead of starting blank
    // until the stream mentions each session again. Live entries win.
    try {
      const cached = parsePreviewMap(await AsyncStorage.getItem(PREVIEWS_KEY))
      if (Object.keys(cached).length > 0) {
        set((state) => ({ previews: { ...cached, ...state.previews } }))
      }
    } catch {
      // Same convenience rule as above.
    }
    // The list snapshot rides the boot path too: on a slow backend the glance
    // view paints instantly from disk — labelled as of when it was saved —
    // instead of blanking behind a spinner until the full farm downloads.
    // Only fills an empty list: if a live fetch has already landed (or lands
    // while this read is in flight), the network data wins untouched.
    try {
      const snapshot = parseSnapshot(await AsyncStorage.getItem(SESSIONS_SNAPSHOT_KEY))
      if (snapshot && snapshot.sessions.length > 0) {
        set((state) =>
          state.sessions.length === 0 && state.listSource === null
            ? { sessions: snapshot.sessions, listSource: "snapshot", listAsOf: snapshot.savedAt }
            : {},
        )
      }
    } catch {
      // Same convenience rule as above.
    }
  },

  applyServerReadState: (state) => {
    set((prev) => {
      const readState = applyServerState(prev.readState, state)
      if (readState === prev.readState) return {}
      persistReadState(readState)
      return { readState }
    })
  },

  markUnread: async (sessionID) => {
    const session = get().sessions.find((s) => s.id === sessionID) ?? (get().currentSession?.id === sessionID ? get().currentSession : undefined)
    const client = clientFor(session?.directory)
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    // Show it immediately: the mark is the whole point of the tap, and a
    // round-trip's worth of "did that work?" is worse than a rare revert.
    const before = get().readState
    const optimistic = optimisticMarkUnread(before, sessionID, Date.now())
    set({ readState: optimistic })
    persistReadState(optimistic)

    try {
      const state = await client.sessionState.update(sessionID, {
        markedUnread: true,
        // Echoing the revision we last saw is what makes a retry idempotent
        // and stops a stale client resurrecting a mark someone else cleared.
        expectedRevision: revisionFor(before, sessionID),
      })
      if (!state) {
        // 404: this daemon has no read-state route. Stop offering the action
        // instead of leaving a mark the server will never know about.
        set((prev) => ({ readState: dropReadState(prev.readState, sessionID), readStateSupported: false }))
        persistReadState(get().readState)
        return
      }
      get().applyServerReadState(state)
    } catch (error) {
      // Anything else is a real failure: put the row back the way the user
      // found it, and say so rather than leaving a mark that does not exist.
      set({ readState: before })
      persistReadState(before)
      Alert.alert(i18n.t("common.error"), i18n.t("sessionsList.alerts.markUnreadFailedMessage"))
    }
  },

  markRead: (sessionID) => {
    const session = get().sessions.find((s) => s.id === sessionID) ?? (get().currentSession?.id === sessionID ? get().currentSession : undefined)
    const client = clientFor(session?.directory)
    if (!client || !get().readStateSupported) return

    const before = get().readState
    // Only an explicit mark needs clearing. Sessions the user has simply never
    // marked would otherwise write a pointless revision bump on every open.
    if (isMarkedUnread(before, sessionID)) {
      const optimistic = optimisticMarkRead(before, sessionID)
      set({ readState: optimistic })
      persistReadState(optimistic)
    }

    // This runs inside selectSession's try block, so a synchronous throw here
    // would surface to the user as "Failed to load session" for a session that
    // loaded perfectly. Opening must never fail because a read stamp did — the
    // next open, or any SSE event, re-converges it.
    try {
      // Clearing is `seenAt`, not `markedUnread: false`, so it stays truthful
      // under a race: the server only drops a mark whose timestamp this seen
      // stamp actually covers. Stamped at least at the session's own updated
      // time so a mark placed against activity we HAVE loaded clears cleanly.
      void client.sessionState
        ?.update(sessionID, {
          seenAt: Math.max(session?.time?.updated ?? 0, Date.now()),
          expectedRevision: revisionFor(before, sessionID),
        })
        .then((state) => {
          if (!state) {
            set({ readStateSupported: false })
            return
          }
          get().applyServerReadState(state)
        })
        .catch(() => {})
    } catch {
      // As above.
    }
  },

  loadSessions: async () => {
    const connState = useConnections.getState()
    // Use a directory-less client so the server returns sessions from ALL projects,
    // not just the one matching the active connection's directory header.
    const client = connState.clientForDirectory(undefined) || connState.client
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    const seq = ++listLoadSeq
    try {
      set({ isLoading: true, error: null })
      // A directory-less list includes sessions across projects. Each row carries
      // its own directory into the session route so subsequent operations stay scoped.
      // No limit. The transport already downloads the FULL global session
      // list (GET /experimental/session takes no params — see
      // src/lib/session-list.ts); `limit: 50` here just sliced away every
      // root past the newest fifty AFTER paying for the download. That slice
      // was the "I feel like I'm missing sessions" bug: front-end filters
      // (recency, search) can only surface what survived it. FlatList
      // virtualizes, so row count is not a render concern.
      // Prefer the live tree when available. Its roots are the only top-level
      // rows; children are fetched on expansion, never mixed into root data.
      const tree = await client.session.tree()
      const sessions = tree ?? await client.session.list({ roots: true })
      if (seq !== listLoadSeq) return
      const liveSessions = sessions.filter((session) => !session.parentID && !deletedSessionIDs.has(session.id))
      set({ sessions: liveSessions, isLoading: false, listSource: "network", listAsOf: Date.now(), listLoadFailed: false })
      persistSessionsSnapshot(liveSessions)
      // Unread marks are not on /session/tree or /session/:id — the card-state
      // route is the only way to learn them, so hydrate once the roots (and
      // therefore the set of directories worth asking about) are known.
      void hydrateReadState(connState.activeConnection?.id, liveSessions)
    } catch (error) {
      if (seq !== listLoadSeq) return
      // Keep whatever rows are on screen (previous load or disk snapshot) —
      // but marked: listLoadFailed drives the "showing sessions from Xm ago
      // · Retry" banner rather than silently presenting stale data as fresh.
      set({ error: "Failed to load sessions", isLoading: false, listLoadFailed: true })
    }
  },

  loadSessionChildren: async (sessionID) => {
    const client = useConnections.getState().clientForDirectory(undefined) || useConnections.getState().client
    if (!client) return
    try {
      const children = await client.session.children(sessionID)
      set((state) => {
        // A child belongs to a visible root only. This prevents an unrelated
        // response from becoming a phantom top-level row.
        if (!state.sessions.some((session) => session.id === sessionID && !session.parentID)) return state
        const other = state.sessions.filter((session) => session.parentID !== sessionID)
        return { sessions: [...other, ...(children ?? []).filter((session) => session.parentID === sessionID && !deletedSessionIDs.has(session.id))] }
      })
    } catch {
      // Expansion is optional. Keep the root usable when an older server has
      // neither children endpoint.
    }
  },

  reconcileSessions: async (lifecycle) => {
    sessionReconcileLifecycle = Math.max(sessionReconcileLifecycle, lifecycle)
    const client = useConnections.getState().clientForDirectory(undefined) || useConnections.getState().client
    if (!client) return []
    const revisions = new Map(sessionMembershipRevisions)
    try {
      const snapshot = await client.session.listSnapshot()
      if (!snapshot.complete || lifecycle !== sessionReconcileLifecycle) return []
      const remoteIDs = new Set(snapshot.sessions.map((session) => session.id))
      const absent = get().sessions.filter((session) => {
        const currentID = get().currentSession?.id
        return !remoteIDs.has(session.id) && session.id !== currentID && revisions.get(session.id) === sessionMembershipRevisions.get(session.id)
      })
      for (const session of absent) get().removeSession(session.id)
      return absent.map((session) => session.id)
    } catch {
      // Reconciliation is opportunistic. A failed request must retain rows.
      return []
    }
  },

  removeSession: (sessionID) => {
    deletedSessionIDs.add(sessionID)
    sessionMembershipRevisions.set(sessionID, (sessionMembershipRevisions.get(sessionID) ?? 0) + 1)
    bumpTranscriptRevision(sessionID)
    if (get().currentSession?.id === sessionID || selectingSessionID === sessionID) selectSeq += 1
    transcriptRevisions.delete(sessionID)
    pendingTranscriptGenerations.delete(sessionID)
    for (const [key, pending] of pendingParts) {
      if (pending.part.sessionID === sessionID) pendingParts.delete(key)
    }
    set((state) => {
      const current = state.currentSession?.id === sessionID
      const lastViewed = Object.fromEntries(Object.entries(state.lastViewed).filter(([id]) => id !== sessionID))
      const readState = dropReadState(state.readState, sessionID)
      const next = {
        sessions: state.sessions.filter((session) => session.id !== sessionID),
        currentSession: current ? null : state.currentSession,
        activeTranscriptSessionID: current ? null : state.activeTranscriptSessionID,
        messages: current ? [] : state.messages,
        parts: current ? {} : state.parts,
        sending: Object.fromEntries(Object.entries(state.sending).filter(([id]) => id !== sessionID)),
        failedMessageIDs: current ? {} : state.failedMessageIDs,
        transcriptCache: dropTranscript(state.transcriptCache, sessionID),
        previews: dropPreview(state.previews, sessionID),
        runningTools: clearSessionTools(state.runningTools, sessionID),
        pendingWakes: Object.fromEntries(Object.entries(state.pendingWakes).filter(([id]) => id !== sessionID)),
        lastViewed,
        readState,
      }
      persistSessionsSnapshot(next.sessions)
      persistReadState(readState)
      AsyncStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(lastViewed)).catch(() => {})
      AsyncStorage.setItem(PREVIEWS_KEY, JSON.stringify(next.previews)).catch(() => {})
      return next
    })
  },

  selectSession: async (sessionID, directory, signal) => {
    flushPendingPartStatusForTranscriptBoundary()
    flushStreamPartUpdates()
    // Use directory-specific client if the session belongs to a different project
    const connState = useConnections.getState()
    const client = directory ? connState.clientForDirectory(directory) : connState.client
    if (!client) {
      set({ error: "No active connection" })
      return false
    }

    const seq = ++selectSeq
    selectingSessionID = sessionID
    const read = focusReads.begin(signal)
    if (!read.isCurrent()) return false
    addBreadcrumb({ category: "session", message: "select", data: { sessionID, hasDirectory: Boolean(directory) } })
    // Re-selecting the session already shown on screen (e.g. #121's
    // useFocusEffect resync firing again on re-entry) is a background
    // refresh, not a cold load: the screen already has this session's
    // messages, and live SSE updates keep flowing to them the whole time.
    // Forcing isLoading back to true here would hide the entire
    // conversation — including anything streaming in live right now —
    // behind a spinner for as long as this redundant fetch takes, and if it
    // stalls (flaky network), the screen looks permanently stuck "loading"
    // until the user backs out and re-enters (issue #150). Only a
    // genuinely new/different session needs the blocking spinner.
    const isColdLoad = isColdSessionLoad(get().currentSession?.id, sessionID)
    try {
      // Park the outgoing session's transcript so switching back is free.
      // Done before the new session's state lands, since the store keeps only
      // one transcript at a time and it is about to be overwritten.
      const outgoing = get().currentSession
      if (outgoing && outgoing.id !== sessionID) {
        set((state) => ({
          transcriptCache: putTranscript(state.transcriptCache, outgoing.id, {
            messages: state.messages,
            parts: state.parts,
            nextCursor: state.nextCursor,
          }),
        }))
      }

      // A transcript we already hold renders immediately and reconciles
      // underneath, instead of showing a spinner over content the client had
      // moments ago. Only the cold path (nothing cached) still blocks.
      const cached = getTranscript(get().transcriptCache, sessionID)
      const hasCachedTranscript = isColdLoad && canRenderFromCache(cached)
      const warmSession = warmSessionFor(get().sessions, sessionID, hasCachedTranscript)
      // Transcript data without matching session metadata is unsafe: controls
      // and sends would still target the previously selected session.
      const canWarmStart = Boolean(warmSession)

      // Reset optimistic sending — SSE sessionStatus is the source of truth
      set((state) => ({
        isLoading: isColdLoad && !canWarmStart ? true : state.isLoading,
        error: null,
        ...(canWarmStart
          ? {
              ...(warmSession ? { currentSession: warmSession } : null),
              messages: cached!.messages,
              parts: cached!.parts,
              nextCursor: cached!.nextCursor,
              hasMore: Boolean(cached!.nextCursor),
            }
          : { hasMore: false, nextCursor: undefined }),
        loadingMore: false,
        sending: { ...state.sending, [sessionID]: false },
      }))

      const [session, page] = await Promise.all([
        client.session.get(sessionID, read.signal),
        client.session.messagesPage(sessionID, transcriptPageParams(pageSize()), read.signal),
      ])

      // A newer selectSession started while we were fetching — discard this
      // stale result so it can't clobber the newer selection.
      if (seq !== selectSeq || !read.isCurrent()) return false

      // Parse the API response format: array of { info, parts }
      const { messages, parts } = parseMessages(page.items)

      // Seed this session's list preview from what we just fetched. The SSE
      // harvest only sees sessions that speak while the app is running, so
      // without this every row stays blank until traffic happens to arrive.
      const seed = previewFromParts(Object.values(parts).flat())

      // Same cold-start gap for the waiting-on panel: a tool that started
      // BEFORE this app connected never emitted a running event to us. The
      // fetched transcript knows — feed every tool part through the tracker
      // (running adds, completed is a no-op or clears a straggler).
      const seedRunning = (map: RunningToolMap) =>
        Object.values(parts)
          .flat()
          .filter((p) => p.type === "tool")
          .reduce((acc, p) => trackToolPart(acc, p, toolCallTitle(p), Date.now()), map)
      // Wakes scheduled before this app connected are in the transcript too.
      const seedWakes = (map: PendingWakeMap) =>
        Object.values(parts)
          .flat()
          .filter((p) => p.type === "tool")
          .reduce((acc, p) => trackWakePart(acc, p, Date.now()), map)

      // Mark it read. Stamped from the session's own updated time rather than
      // `Date.now()`: anything the server writes *after* this fetch is content
      // the user has genuinely not seen, and a wall-clock stamp would mark it
      // read anyway.
      const viewedAt = Math.max(session.time?.updated ?? 0, get().lastViewed[sessionID] ?? 0)
      const nextViewed = markViewed(get().lastViewed, sessionID, viewedAt)
      AsyncStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(nextViewed)).catch(() => {})
      // Opening it is also what clears a server-side mark, so every device
      // agrees. Fire-and-forget by contract: it must not be able to fail the
      // open, which is why it sits after the local stamp rather than gating it.
      get().markRead(sessionID)

      set((state) => ({
        lastViewed: nextViewed,
        ...(seed ? { previews: persistedPutPreview(state.previews, sessionID, seed) } : null),
        runningTools: seedRunning(state.runningTools),
        pendingWakes: seedWakes(state.pendingWakes),
        currentSession: session,
        messages,
        parts,
        isLoading: false,
        // The server tells us whether more history exists. Inferring it from
        // `length >= pageSize` was wrong on the exact-multiple boundary: a
        // session with precisely pageSize messages left would claim more, and
        // the follow-up fetch would come back empty.
        nextCursor: page.nextCursor,
        hasMore: Boolean(page.nextCursor),
      }))
      selectingSessionID = null
      flushStreamPartUpdates()
      return true
    } catch (err) {
      if (seq !== selectSeq || !read.isCurrent()) return false
      console.error("Failed to load session:", err)
      set({ error: "Failed to load session", isLoading: false })
      return false
    } finally {
      if (selectingSessionID === sessionID) {
        selectingSessionID = null
        flushStreamPartUpdates()
      }
      read.dispose()
    }
  },

  // Pull ONE older page and prepend it.
  //
  // This used to refetch the entire session and replace the store with it,
  // then set hasMore: false because it had, tautologically, loaded everything.
  // On a long transcript that is a single unbounded request into a phone's
  // memory. The server has always supported `?limit=N&before=<cursor>` with an
  // X-Next-Cursor header; the client just never read it. See
  // src/lib/message-page.ts.
  loadOlderMessages: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return
    if (!isTranscriptActive(get().activeTranscriptSessionID, session.id)) return
    if (get().loadingMore || !get().hasMore) return

    const cursor = get().nextCursor
    // hasMore without a cursor would page from the end forever, re-fetching
    // the newest page each time.
    if (!cursor) {
      set({ hasMore: false })
      return
    }

    const seq = selectSeq
    try {
      set({ loadingMore: true })

      const { items, nextCursor } = await client.session.messagesPage(session.id, transcriptPageParams(pageSize(), cursor))

      // The user navigated to a different session while this page was in
      // flight — prepending it now would splice one session's history into
      // another's transcript.
      if (
        seq !== selectSeq ||
        get().currentSession?.id !== session.id ||
        !isTranscriptActive(get().activeTranscriptSessionID, session.id)
      ) return

      const { messages: older, parts: olderParts } = parseMessages(items)
      // Invalidate any older refresh response before consuming this cursor.
      bumpTranscriptRevision(session.id)
      set((state) => ({
        messages: mergeOlderPage({ existing: state.messages, older }),
        parts: mergeOlderParts(state.parts, olderParts),
        loadingMore: false,
        nextCursor,
        hasMore: Boolean(nextCursor),
      }))
    } catch (error) {
      if (
        seq !== selectSeq ||
        get().currentSession?.id !== session.id ||
        !isTranscriptActive(get().activeTranscriptSessionID, session.id)
      ) return
      console.error("Failed to load older messages:", error)
      set({ loadingMore: false })
    }
  },

  createSession: async (title) => {
    flushPendingPartStatusForTranscriptBoundary()
    flushStreamPartUpdates()
    const connState = useConnections.getState()
    const client = connState.client
    if (!client) {
      set({ error: "No active connection" })
      return null
    }

    try {
      const created = await client.session.create({ title })
      // Don't optimistically add to sessions list — let loadSessions() handle it
      // to avoid duplicate key errors from race conditions
      set({
        currentSession: created,
        messages: [],
        parts: {},
        hasMore: false,
        nextCursor: undefined,
        loadingMore: false,
        // A brand-new session must not inherit a previous failure's banner,
        // which otherwise makes a working session look broken on entry.
        error: null,
      })
      return created
    } catch (error) {
      set({ error: "Failed to create session" })
      return null
    }
  },

  deleteSession: async (sessionID) => {
    flushStreamPartUpdates()
    const session = get().sessions.find((s) => s.id === sessionID)
    const client = clientFor(session?.directory)
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    try {
      await client.session.delete(sessionID)
      get().removeSession(sessionID)
    } catch (error) {
      set({ error: "Failed to delete session" })
    }
  },

  sendMessage: async (text, model, agent, files, variant) => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) {
      set({ error: "No active session" })
      return
    }

    // Declared out here so the catch below can mark exactly this message
    // failed; it is assigned as soon as the optimistic message is built.
    let optimisticID: string | null = null

    try {
      if (!get().sending[session.id]) {
        optimisticSendingRevisions.set(session.id, optimisticSendingRevision(session.id) + 1)
      }
      set((state) => ({ sending: { ...state.sending, [session.id]: true }, error: null }))
      track(AnalyticsEvent.MessageSent)

      // Add user message optimistically
      const ts = Date.now()
      optimisticID = `temp-${ts}`
      const userMessage: Message = {
        id: optimisticID,
        sessionID: session.id,
        role: "user",
        time: { created: ts },
        model,
        agent,
      }
      const optimisticParts: Part[] = []
      if (text) {
        optimisticParts.push({
          id: `temp-part-text-${ts}`,
          messageID: userMessage.id,
          type: "text",
          text,
        })
      }
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          optimisticParts.push({
            id: `temp-part-file-${ts}-${i}`,
            messageID: userMessage.id,
            type: "file",
            mime: f.mime,
            url: f.uri,
            filename: f.filename,
          })
        }
      }

      bumpTranscriptRevision(session.id)
      set((state) => ({
        messages: [...state.messages, userMessage],
        parts: { ...state.parts, [userMessage.id]: optimisticParts },
      }))

      // Build prompt parts - images are already converted to JPEG with base64 by toJpeg()
      const promptParts: Array<
        { type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }
      > = []
      if (text) {
        promptParts.push({ type: "text", text })
      }
      if (files) {
        for (const f of files) {
          const url = f.base64 ? `data:${f.mime};base64,${f.base64}` : f.uri
          promptParts.push({ type: "file", mime: f.mime, url, filename: f.filename })
        }
      }

      // Await submission (POST to /prompt_async resolves fast, well before the
      // streamed response) so a failure here can propagate to the caller — SSE
      // events still update messages/parts/status in real-time on success.
      await client.session.prompt(session.id, { parts: promptParts, model, agent, variant })
    } catch (err) {
      console.error("[sendMessage] error:", err)
      const stillCurrent = get().currentSession?.id === session.id
      set((state) => ({
        ...(stillCurrent ? { error: String(err) } : {}),
        sending: { ...state.sending, [session.id]: false },
        // Mark the optimistic message failed so it renders as such rather
        // than vanishing on the refresh below.
        ...(optimisticID ? { failedMessageIDs: { ...state.failedMessageIDs, [optimisticID]: true as const } } : {}),
      }))
      if (stillCurrent) get().refreshMessages()
      throw err
    }
  },

  clearRunningTools: (sessionID) => {
    set((state) => ({ runningTools: clearSessionTools(state.runningTools, sessionID) }))
  },

  abortSession: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return

    try {
      await client.session.abort(session.id)
      // Mark only after the abort request succeeded — if it failed, the run
      // continues and any eventual completion is a genuine response.
      abortedSessions.add(session.id)
      set((state) => ({ sending: { ...state.sending, [session.id]: false } }))
    } catch {
      set({ error: "Failed to abort session" })
    }
  },

  refreshMessages: async (signal) => {
    flushStreamPartUpdates()
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return
    const seq = selectSeq
    const revision = transcriptRevision(session.id)

    try {
      const oldestLoadedID = oldestLoadedMessageID(get().messages)
      const previousCursor = get().nextCursor
      let before: string | undefined
      let nextCursor: string | undefined
      let pages = 0
      let response: MessageWithParts[] = []
      do {
        if (
          signal?.aborted ||
          seq !== selectSeq ||
          get().currentSession?.id !== session.id ||
          !isTranscriptActive(get().activeTranscriptSessionID, session.id) ||
          !shouldApplyTranscriptSnapshot(revision, transcriptRevision(session.id))
        ) return
        const page = await client.session.messagesPage(
          session.id,
          transcriptPageParams(pageSize(), before),
          signal,
          { sampleLatency: refreshPageSampleLatency(pages) },
        )
        response = prependRefreshPage(response, page.items)
        nextCursor = page.nextCursor
        before = nextCursor
        pages += 1
      } while (shouldFetchRefreshPage({
        fetched: response.map((item) => item.info),
        oldestLoadedID,
        nextCursor,
        pages,
      }))
      if (
        signal?.aborted ||
        seq !== selectSeq ||
        get().currentSession?.id !== session.id ||
        !isTranscriptActive(get().activeTranscriptSessionID, session.id) ||
        !shouldApplyTranscriptSnapshot(revision, transcriptRevision(session.id))
      ) return
      const { messages, parts } = parseMessages(response)
      // Keep optimistic messages the server hasn't acknowledged — otherwise a
      // refresh triggered by a failed send deletes the text the user typed.
      // The first successful HTTP writer wins; later concurrent snapshots
      // observe this revision change and cannot overwrite it out of order.
      bumpTranscriptRevision(session.id)
      set((state) => {
        const merged = mergeRefreshWindow({
          existing: state.messages,
          existingParts: state.parts,
          fetched: messages,
          fetchedParts: parts,
          nextCursor,
          previousCursor,
          capped: pages >= REFRESH_PAGE_CAP && Boolean(nextCursor) && !messages.some((message) => message.id === oldestLoadedID),
        })
        return merged
      })
    } catch (error) {
      if (
        signal?.aborted ||
        seq !== selectSeq ||
        get().currentSession?.id !== session.id ||
        !isTranscriptActive(get().activeTranscriptSessionID, session.id)
      ) return
      set({ error: "Failed to refresh messages" })
    }
  },

  reconcileOpenMessages: () => {
    const session = get().currentSession
    const client = clientFor(session?.directory)
    if (!client || !session || !isTranscriptActive(get().activeTranscriptSessionID, session.id)) return Promise.resolve()

    const seq = selectSeq
    const revision = transcriptRevision(session.id)
    return openTranscriptReconciler.run(session.id, async () => {
      try {
        const response = await client.session.messagesPage(session.id, transcriptPageParams(pageSize()))
        if (
          seq !== selectSeq ||
          get().currentSession?.id !== session.id ||
          !isTranscriptActive(get().activeTranscriptSessionID, session.id) ||
          !shouldApplyTranscriptSnapshot(revision, transcriptRevision(session.id))
        ) return
        bumpTranscriptRevision(session.id)
        set((state) => mergeReconciledTranscript(state, response.items))
      } catch (error) {
        if (
          seq !== selectSeq ||
          get().currentSession?.id !== session.id ||
          !isTranscriptActive(get().activeTranscriptSessionID, session.id)
        ) return
        set({ error: "Failed to reconcile messages" })
      }
    })
  },

  // Marks messageID (and everything after it) as pending revert, so the
  // user can re-edit and resend it. The server keeps the underlying
  // messages until the next prompt runs cleanup, or unrevertSession() below
  // undoes it — so this only flips session.revert, it doesn't delete
  // anything itself. Returns the reverted message's text/files so the
  // caller can prefill the composer.
  revertToMessage: async (messageID) => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return { ok: false, reason: "error" }

    try {
      const updated = await client.session.revert(session.id, messageID)
      set((state) => ({
        currentSession: state.currentSession?.id === session.id ? updated : state.currentSession,
      }))
      return { ok: true, ...extractPromptFromParts(get().parts[messageID]) }
    } catch (err) {
      if (err instanceof ApiError) {
        // Older servers (pre session.revert) 404 on this route — degrade
        // gracefully instead of surfacing a generic error.
        if (err.status === 404) return { ok: false, reason: "unsupported" }
        // Expired/invalid credentials — distinct from a generic failure so
        // the caller can point the user at reconnecting rather than "retry".
        if (err.status === 401 || err.status === 403) return { ok: false, reason: "auth" }
      }
      console.error("Failed to revert message:", err)
      set({ error: "Failed to revert message" })
      return { ok: false, reason: "error" }
    }
  },

  unrevertSession: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return false

    try {
      const updated = await client.session.unrevert(session.id)
      set((state) => ({
        currentSession: state.currentSession?.id === session.id ? updated : state.currentSession,
      }))
      return true
    } catch (err) {
      console.error("Failed to unrevert session:", err)
      set({ error: "Failed to restore reverted messages" })
      return false
    }
  },

  handleEvent: (event) => {
    const props = (event as any).properties || {}

    if (event.type === "message.part.updated") {
      const part = props.part as Part | undefined
      if (part) enqueueStreamPart(part, typeof props.receivedAt === "number" ? props.receivedAt : Date.now())
      return
    }

    if (event.type === "session.deleted") {
      const sessionID = (props.sessionID || props.info?.id) as string | undefined
      if (sessionID) get().removeSession(sessionID)
      return
    }

    if (event.type === "session.created") {
      const session = (props.info || props) as Session | undefined
      if (!session?.id) return
      deletedSessionIDs.delete(session.id)
      sessionMembershipRevisions.set(session.id, (sessionMembershipRevisions.get(session.id) ?? 0) + 1)
      set((state) => (state.sessions.some((item) => item.id === session.id) ? {} : { sessions: [session, ...state.sessions] }))
      return
    }

    const { currentSession } = get()
    if (!currentSession) return

    switch (event.type) {
      case "message.updated": {
        flushStreamPartUpdates()
        if (!isTranscriptActive(get().activeTranscriptSessionID, currentSession.id)) return
        const message = (props.info || props.message) as Message | undefined
        if (!message) return
        if (!isLiveEventForSession(message.sessionID, currentSession.id)) {
          // Parked transcripts are intentionally snapshots. Updating up to
          // five invisible parent/subagent caches per token recreates the farm
          // slowdown; selecting one performs an authoritative fetch.
          return
        }

        bumpTranscriptRevision(currentSession.id)
        set((state) => ({
          messages: isHiddenSyntheticUserMessage(message, state.parts[message.id])
            ? state.messages.filter((item) => item.id !== message.id)
            : mergeIncomingMessage(state.messages, message),
          // A live update for the session on screen is proof it has content
          // to show — clear any stuck spinner even if the initial (or a
          // redundant re-focus) GET hasn't resolved yet, or never does
          // (issue #150). Only ever clears, never sets it back to true.
          isLoading: false,
        }))
        break
      }

      case "message.removed": {
        if (!isTranscriptActive(get().activeTranscriptSessionID, currentSession.id)) return
        const messageID = props.messageID as string
        if (!messageID) return
        bumpTranscriptRevision(currentSession.id)
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== messageID),
          parts: Object.fromEntries(Object.entries(state.parts).filter(([k]) => k !== messageID)),
        }))
        break
      }

      case "session.updated": {
        const session = (props.info || props) as Session | undefined
        if (!session?.id) return
        if (deletedSessionIDs.has(session.id)) return
        sessionMembershipRevisions.set(session.id, (sessionMembershipRevisions.get(session.id) ?? 0) + 1)

        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
          currentSession: state.currentSession?.id === session.id ? session : state.currentSession,
          isLoading: isLiveEventForSession(session.id, state.currentSession?.id) ? false : state.isLoading,
        }))
        break
      }
    }
  },
}))
