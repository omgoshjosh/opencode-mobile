import { create } from "zustand"
import { ApiError, type Session, type Message, type Part, type Event, type MessageWithParts, type Client } from "../lib/sdk"
import { useConnections } from "./connections"
import { useSettings } from "./settings"
import { addBreadcrumb } from "../lib/sentry"
import { AnalyticsEvent, track } from "../lib/analytics"
import { extractPromptFromParts, type PromptFromParts } from "../lib/prompt-from-parts"
import { mergePendingMessages } from "../lib/message-delivery"
import { mergeIncomingMessage } from "../lib/message-merge"
import { isColdSessionLoad, isLiveEventForSession } from "../lib/session-load-reconcile"
import { mergeOlderPage, mergeOlderParts, refreshWindowSize } from "../lib/message-page"
import { canRenderFromCache, dropTranscript, getTranscript, putTranscript, type TranscriptCache } from "../lib/transcript-cache"
import { dropPreview, parsePreviewMap, previewFromParts, previewText, putPreview, type PreviewMap } from "../lib/session-preview"
import { markViewed, parseLastViewed, type LastViewedMap } from "../lib/session-attention"
import { serializeSnapshot, parseSnapshot } from "../lib/list-freshness"
import { trackToolPart, clearSessionTools, type RunningToolMap } from "../lib/running-tools"
import { trackWakePart, type PendingWakeMap } from "../lib/pending-wakes"
import { toolCallTitle } from "../lib/tool-titles"
import { createFocusReadCoordinator } from "../lib/focus-read"
import { isTranscriptActive, nextActiveTranscript, shouldApplyTranscriptSnapshot } from "../lib/transcript-focus"
import { warmSessionFor } from "../lib/warm-session"
import AsyncStorage from "@react-native-async-storage/async-storage"

// Helper to convert API response to our internal format
function parseMessages(response: MessageWithParts[]): { messages: Message[]; parts: Record<string, Part[]> } {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}

  for (const item of response || []) {
    messages.push(item.info)
    parts[item.info.id] = item.parts || []
  }

  return { messages, parts }
}

// Holds only session ids and timestamps -- no message text, titles or tool
// output. See the allowlist in src/lib/persisted-keys.test.ts.
const LAST_VIEWED_KEY = "session_last_viewed"

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
  error: string | null
  // Where the rows in `sessions` came from and when — the inputs to the
  // list's staleness banner (src/lib/list-freshness.ts). The UI must be able
  // to say "showing sessions from 20m ago" instead of presenting disk-cached
  // or refresh-failed data as current.
  listSource: "network" | "snapshot" | null
  listAsOf: number | null
  listLoadFailed: boolean

  // Actions
  loadSessions: (options?: { rootsOnly?: boolean }) => Promise<void>
  loadLastViewed: () => Promise<void>
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

// Monotonic token guarding selectSession against out-of-order resolution: a
// slow fetch for a session the user has already navigated away from must not
// overwrite the messages/currentSession of a newer selection. Each call takes
// the next value and only commits its result if still the latest.
let selectSeq = 0
const focusReads = createFocusReadCoordinator()
const transcriptRevisions = new Map<string, number>()
export const STREAM_PART_FLUSH_WINDOW_MS = 100

// A stream can deliver one event per token. Keep only the newest version of a
// part while retaining the insertion order of distinct parts in this window.
const pendingParts = new Map<string, { part: Part; receivedAt: number }>()
const pendingTranscriptGenerations = new Map<string, number>()
let streamPartTimer: ReturnType<typeof setTimeout> | null = null

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

  const updates = [...pendingParts.values()]
  pendingParts.clear()
  const generations = new Map(pendingTranscriptGenerations)
  pendingTranscriptGenerations.clear()
  useSessions.setState((state) => {
    let previews = state.previews
    let runningTools = state.runningTools
    let pendingWakes = state.pendingWakes
    let parts = state.parts
    let transcriptChanged = false
    for (const { part, receivedAt } of updates) {
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
      ...(transcriptChanged ? { parts, isLoading: false } : null),
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
  if (sessionID && state.currentSession?.id === sessionID && isTranscriptActive(state.activeTranscriptSessionID, sessionID)) {
    bumpTranscriptRevision(sessionID)
    pendingTranscriptGenerations.set(sessionID, transcriptRevision(sessionID))
  }
  pendingParts.set(part.id, { part, receivedAt })
  if (!streamPartTimer) streamPartTimer = setTimeout(flushStreamPartUpdates, STREAM_PART_FLUSH_WINDOW_MS)
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
  runningTools: {},
  pendingWakes: {},
  error: null,
  listSource: null,
  listAsOf: null,
  listLoadFailed: false,

  setTranscriptActive: (sessionID, active) => {
    if (nextActiveTranscript(get().activeTranscriptSessionID, sessionID, active) !== get().activeTranscriptSessionID) {
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

  loadSessions: async (options) => {
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
      // includeChildren keeps swarm role/subagent sessions alongside their
      // roots so the "Swarm root" grouping mode has something to nest. `limit`
      // still counts roots only, so the visible session count is unchanged.
      // No limit. The transport already downloads the FULL global session
      // list (GET /experimental/session takes no params — see
      // src/lib/session-list.ts); `limit: 50` here just sliced away every
      // root past the newest fifty AFTER paying for the download. That slice
      // was the "I feel like I'm missing sessions" bug: front-end filters
      // (recency, search) can only surface what survived it. FlatList
      // virtualizes, so row count is not a render concern.
      // rootsOnly (the hide-subagents view) narrows SERVER-side: children
      // never leave the database, so the fetch is one small page instead of
      // paging the whole farm. Otherwise children ride along for the
      // Swarm-root grouping as before.
      // Roots-first two-phase (cold start only): the full farm download pages
      // serially, so on a slow backend the glance view waited RTT×pages for
      // rows it could have had in one. Phase 1 reuses the server-side roots
      // narrowing (one small page) and commits immediately; phase 2 fetches
      // the full list with children for the Swarm-root grouping and replaces.
      // Warm refreshes skip phase 1: committing a roots-only interim over a
      // list that already has children would collapse expanded swarm groups
      // for a beat and then restore them — a flicker worse than the wait.
      const cold = get().sessions.length === 0 || get().listSource !== "network"
      const twoPhase = !options?.rootsOnly && cold
      if (twoPhase) {
        try {
          const roots = await client.session.list({ roots: true, includeChildren: false })
          if (seq === listLoadSeq && roots.length > 0) {
            set({ sessions: roots, isLoading: false, listSource: "network", listAsOf: Date.now(), listLoadFailed: false })
          }
        } catch {
          // Phase 1 is opportunistic; phase 2 below is the load of record and
          // owns failure reporting.
        }
      }

      const sessions = await client.session.list({ roots: true, includeChildren: !options?.rootsOnly })
      if (seq !== listLoadSeq) return
      set({ sessions, isLoading: false, listSource: "network", listAsOf: Date.now(), listLoadFailed: false })
      persistSessionsSnapshot(sessions)
    } catch (error) {
      if (seq !== listLoadSeq) return
      // Keep whatever rows are on screen (previous load or disk snapshot) —
      // but marked: listLoadFailed drives the "showing sessions from Xm ago
      // · Retry" banner rather than silently presenting stale data as fresh.
      set({ error: "Failed to load sessions", isLoading: false, listLoadFailed: true })
    }
  },

  selectSession: async (sessionID, directory, signal) => {
    flushStreamPartUpdates()
    // Use directory-specific client if the session belongs to a different project
    const connState = useConnections.getState()
    const client = directory ? connState.clientForDirectory(directory) : connState.client
    if (!client) {
      set({ error: "No active connection" })
      return false
    }

    const seq = ++selectSeq
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
        client.session.messagesPage(sessionID, { limit: pageSize() }, read.signal),
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
      return true
    } catch (err) {
      if (seq !== selectSeq || !read.isCurrent()) return false
      console.error("Failed to load session:", err)
      set({ error: "Failed to load session", isLoading: false })
      return false
    } finally {
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

      const { items, nextCursor } = await client.session.messagesPage(session.id, {
        limit: pageSize(),
        before: cursor,
      })

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
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionID),
        currentSession: state.currentSession?.id === sessionID ? null : state.currentSession,
        messages: state.currentSession?.id === sessionID ? [] : state.messages,
        parts: state.currentSession?.id === sessionID ? {} : state.parts,
        // Otherwise a deleted session's transcript stays warm and would be
        // rendered from cache if anything navigated back to its id.
        transcriptCache: dropTranscript(state.transcriptCache, sessionID),
        previews: dropPreview(state.previews, sessionID),
      }))
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
      // Refresh exactly the window the user is looking at, not the whole
      // session. Unbounded here meant every focus/resync re-downloaded the
      // entire transcript; refreshWindowSize keeps what they paged into
      // without letting a long session reopen that hole.
      const response = await client.session.messages(session.id, {
        limit: refreshWindowSize(get().messages.length, pageSize()),
      }, signal)
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
      set((state) => ({ messages: mergePendingMessages(messages, state.messages), parts: { ...state.parts, ...parts } }))
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
          messages: mergeIncomingMessage(state.messages, message),
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
