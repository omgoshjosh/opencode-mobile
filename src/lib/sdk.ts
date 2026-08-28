// SDK client wrapper for React Native
// We create our own lightweight client that mirrors the opencode SDK patterns
// but works in React Native environment
// expo/fetch provides WinterCG-compliant fetch with ReadableStream support for SSE
import { fetch as expoFetch } from "expo/fetch"
import { buildRequestHeaders } from "./headers"
import { clientInfoFrom, clientInfoHeader } from "./client-info"
import * as Application from "expo-application"
import { Platform } from "react-native"
import { SSEParser } from "./sse"
import { apiErrorFor } from "./api-error"
import { loadSessionList } from "./session-list"
import { LIVENESS_TIMEOUT_MS } from "./sse-liveness"
import { nextCursorFrom } from "./message-page"
import { requestSignal } from "./request-signal"
import type { FileRoot } from "./file-roots"
import type { RoleInput as SwarmRoleInput, Swarm as SwarmInfo } from "./swarm-crud"

export { ApiAuthError, isAuthError } from "./api-error"

export interface ClientConfig {
  baseUrl: string
  directory?: string
  auth?: {
    username: string
    password: string
  }
}

export interface Session {
  id: string
  slug: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  version: string
  agent?: string
  share?: { url: string }
  // The model this session is persisted as running. Note the server uses `id`
  // here, while messages and the catalog store use `modelID`. For a swarm this
  // is the synthetic facade { providerID: "swarm", id: <swarmID> } — the
  // orchestrator's real execution model appears only on assistant messages.
  // See src/lib/swarm-model.ts.
  model?: {
    providerID: string
    id: string
    variant?: string
  }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
  }
  // Present while a message (and everything after it) is pending revert —
  // the server keeps the underlying messages until the next prompt/summarize
  // call runs cleanup (or the revert is undone via session.unrevert).
  revert?: {
    messageID: string
    partID?: string
  }
}

export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  time: {
    created: number
    completed?: number
  }
  // User message fields
  agent?: string
  model?: { providerID: string; modelID: string }
  // Assistant message fields
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
  error?: {
    name?: string
    message?: string
    data?: Record<string, unknown>
  }
  finish?: string
}

// API returns messages with parts embedded
export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export interface Part {
  id: string
  sessionID?: string
  messageID: string
  type:
    | "text"
    | "reasoning"
    | "tool"
    | "file"
    | "snapshot"
    | "patch"
    | "step-start"
    | "step-finish"
    | "subtask"
    | "retry"
    | "compaction"
    | "agent"
  // Text / reasoning part
  text?: string
  synthetic?: boolean
  ignored?: boolean
  metadata?: Record<string, unknown>
  // Tool part
  tool?: string
  callID?: string
  state?: {
    status: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: unknown
    title?: string
    error?: { message: string }
    time?: { start?: number; end?: number }
    // Tool-specific. For `task` this carries { sessionId, parentSessionId,
    // model, runID } — the link to the subagent's own session. See
    // src/lib/subagent-link.ts.
    metadata?: unknown
  }
  // Timing
  time?: { start?: number; end?: number }
  // File part
  mime?: string
  url?: string
  filename?: string
}

export interface Agent {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  model?: { modelID: string; providerID: string }
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export interface Command {
  name: string
  description?: string
  agent?: string
  model?: string
  mcp?: boolean
  template: string
  subtask?: boolean
  hints: string[]
}

export interface Project {
  id: string
  name?: string
  path: {
    cwd: string
    root: string
    absolute: string
  }
}

export interface FileEntry {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export interface Event {
  type: string
  properties: Record<string, unknown>
}

export interface HealthResponse {
  healthy: boolean
  version: string
}

// The OpencodeX management API lives under an experimental prefix; swarm
// endpoints are not part of the base opencode surface.
const OPENCODEX_ROOT = "/experimental/opencodex"

export interface SkillInfo {
  name: string
  description?: string
  location: string
  content: string
}

// Re-exported so callers get the swarm types from the client module they
// already import, while the definitions stay with the pure edit logic.
export type { RoleInput as SwarmRoleInput, Role as SwarmRole, Swarm as SwarmInfo } from "./swarm-crud"

const REQUEST_TIMEOUT_MS = 30_000

// Thrown by request() on a non-2xx response. Carries the HTTP status so
// callers can distinguish e.g. 404 (older server, endpoint missing) from
// other failures without parsing the message string.
export class ApiError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`API Error: ${status} - ${body}`)
    this.name = "ApiError"
    this.status = status
  }
}

// Computed once: the native values cannot change while the app is running.
// Lets the server identify which client build a request came from, which was
// previously impossible even in principle.
const CLIENT_INFO_HEADER = clientInfoHeader(
  clientInfoFrom({
    version: Application.nativeApplicationVersion,
    build: Application.nativeBuildVersion,
    platform: Platform.OS,
  }),
)

function createHeaders(config: ClientConfig): HeadersInit {
  return buildRequestHeaders({ ...config, clientInfo: CLIENT_INFO_HEADER })
}

// `timeoutMs` lets specific callers (e.g. the onboarding health-check) fail
// faster than the general REQUEST_TIMEOUT_MS used by real session calls.
// Leave it unset to get the default.
async function request<T>(
  config: ClientConfig,
  path: string,
  options: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const url = `${config.baseUrl}${path}`
  const headers = { ...createHeaders(config), ...options.headers }
  const response = await fetchWithTimeout(
    url,
    {
      ...options,
      headers,
    },
    timeoutMs,
  )

  if (!response.ok) {
    const error = await response.text()
    throw apiErrorFor(response.status, `API Error: ${response.status} - ${error}`)
  }

  return response.json()
}

/**
 * As `request`, but hands back the response headers too.
 *
 * Paged endpoints carry their continuation token in `X-Next-Cursor` rather
 * than in the body, so a body-only helper cannot page.
 */
async function requestWithHeaders<T>(
  config: ClientConfig,
  path: string,
  options: RequestInit = {},
): Promise<{ body: T; headers: Headers }> {
  const url = `${config.baseUrl}${path}`
  const headers = { ...createHeaders(config), ...options.headers }
  const response = await fetchWithTimeout(url, { ...options, headers })

  if (!response.ok) {
    const error = await response.text()
    throw apiErrorFor(response.status, `API Error: ${response.status} - ${error}`)
  }

  return { body: (await response.json()) as T, headers: response.headers }
}

// Latency observer, injected by src/stores/rest-health.ts. A callback rather
// than a store import keeps this file free of app-state dependencies (and
// unit-testable under plain node). Settled responses (any status) and
// timeouts report — each measures how long the server held the line. Other
// failures don't: a connection refused in 30ms would land as a "fast" sample
// and clear a slow verdict the server never earned (dead-vs-slow belongs to
// the SSE indicator), and a user abort says nothing about the server at all.
let latencyReporter: ((ms: number) => void) | null = null
export function setLatencyReporter(fn: ((ms: number) => void) | null) {
  latencyReporter = fn
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const request = requestSignal(options.signal ?? undefined, timeoutMs)

  const startedAt = Date.now()
  try {
    const response = await fetch(url, { ...options, signal: request.signal })
    latencyReporter?.(Date.now() - startedAt)
    return response
  } catch (error) {
    if (request.timedOut()) {
      latencyReporter?.(Date.now() - startedAt)
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    request.dispose()
  }
}

// Races a stream read against a deadline. Rejecting (rather than returning a
// sentinel) keeps the failure on the same path as a genuine transport error, so
// the caller's reconnect logic needs no special case.
async function readWithTimeout<T>(
  reader: { read: () => Promise<{ done: boolean; value?: T }> },
  timeoutMs: number,
): Promise<{ done: boolean; value?: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SSE stream idle for ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createClient(config: ClientConfig) {
  // Normalize once: a trailing slash on baseUrl (e.g. pasted into Advanced
  // mode or the Edit screen) would otherwise survive into every
  // `${config.baseUrl}${path}` concatenation below as a double slash, which
  // every request then fails against (while the diagnostics probe, which
  // reconstructs a clean URL, reports "works now"). A bare URL with no
  // trailing slash is untouched.
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }
  return {
    global: {
      // `timeoutMs` overrides the default REQUEST_TIMEOUT_MS — used by the
      // onboarding connection test to fail fast on a bad/unreachable IP
      // instead of hanging for the full 30s (issue: first-run bounce).
      health: (timeoutMs?: number) => request<HealthResponse>(config, "/global/health", {}, timeoutMs),
      // SSE event stream - returns async iterator
      // Pass an AbortSignal to cancel the connection
      async *events(signal?: AbortSignal): AsyncGenerator<Event> {
        const url = `${config.baseUrl}/global/event`
        const headers = createHeaders(config)
        // Remove Content-Type for SSE (it's text/event-stream)
        delete (headers as Record<string, string>)["Content-Type"]

        // Must use expo/fetch for ReadableStream support on native
        const response = await expoFetch(url, { headers, signal })
        if (!response.ok || !response.body) {
          throw apiErrorFor(response.status, `Failed to connect to event stream: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const parser = new SSEParser()

        let receivedFirstByte = false
        try {
          while (true) {
            // Bound the read. A half-open socket -- routine when a phone moves
            // between Wi-Fi and cellular, or wakes from doze -- yields no bytes,
            // no `done` and no error, so an unbounded `reader.read()` parks
            // forever and nothing ever triggers a reconnect. The server
            // heartbeats every ~10s, so silence past LIVENESS_TIMEOUT_MS is
            // evidence of a dead stream rather than an idle one. Throwing here
            // hands control to the caller's existing reconnect path.
            const { done, value } = await readWithTimeout(reader, LIVENESS_TIMEOUT_MS)
            if (done) {
              console.log("[SSE] stream ended")
              break
            }

            if (!receivedFirstByte) {
              receivedFirstByte = true
              console.log(`[SSE] first byte received (${value?.byteLength ?? 0} bytes)`)
            }

            for (const data of parser.push(decoder.decode(value, { stream: true }))) {
              try {
                yield JSON.parse(data)
              } catch (err) {
                console.warn("[SSE] Failed to parse event", {
                  length: data.length,
                  error: err instanceof Error ? err.message : String(err),
                })
              }
            }
          }
        } finally {
          reader.releaseLock()
        }
      },
    },

    project: {
      list: () => request<Project[]>(config, "/project"),
      current: () => request<Project>(config, "/project/current"),
    },

    // Server-side filesystem browsing, scoped to this client's directory
    // (see ClientConfig.directory / x-opencode-directory header). Use
    // clientForDirectory(dir) to get a client rooted at a specific folder,
    // then list("." ) to enumerate its immediate children.
    file: {
      list: (params: { path?: string } = {}) => {
        const query = new URLSearchParams({ path: params.path ?? "." })
        return request<FileEntry[]>(config, `/file?${query.toString()}`)
      },
      // Enumerate the server's filesystem roots (mounted drives, home dir)
      // to seed the directory browser's pinned top-level entries. Resolves
      // to null on servers that don't yet expose GET /file/roots (older
      // opencode builds) so callers fall back to manual path entry instead
      // of crashing; other errors propagate like any other request.
      roots: async (): Promise<FileRoot[] | null> => {
        try {
          return await request<FileRoot[]>(config, "/file/roots")
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
    },

    path: {
      get: () =>
        request<{ home: string; state: string; config: string; worktree: string; directory: string }>(config, "/path"),
    },

    session: {
      // Prefer the GLOBAL experimental endpoint (all sessions across every
      // directory) so the Recent Sessions list works without the user first
      // picking a folder — a directory-less GET /session is directory-scoped
      // and returns [] on servers whose active dir has no sessions. Shaping
      // (roots filter, search, sort-by-updated, limit) happens client-side in
      // loadSessionList; we fetch /experimental/session with no query params
      // because the server applies `limit` before we can filter to roots.
      // Falls back to the legacy /session path only on 404 (older servers).
      list: (params?: { roots?: boolean; limit?: number; search?: string; includeChildren?: boolean }): Promise<Session[]> =>
        loadSessionList(
          {
            // One page per call; loadSessionList drives the cursor loop. The
            // endpoint defaults to limit=100 and silently truncates, so the
            // "no params = everything" assumption this code used to make
            // dropped every session past #100 by recency.
            getExperimental: async (query) => {
              const response = await fetchWithTimeout(`${config.baseUrl}/experimental/session${query}`, {
                headers: createHeaders(config),
              })
              // Older servers lack this route — signal fallback to legacy /session.
              if (response.status === 404) return null
              if (!response.ok) {
                const body = await response.text()
                throw apiErrorFor(response.status, `API Error: ${response.status} - ${body}`)
              }
              const cursorHeader = response.headers.get("x-next-cursor")
              const nextCursor = cursorHeader != null ? Number(cursorHeader) : undefined
              return {
                sessions: await response.json(),
                nextCursor: Number.isFinite(nextCursor as number) ? nextCursor : undefined,
              }
            },
            getLegacy: (query) => request<Session[]>(config, `/session${query}`),
          },
          params,
        ),

      get: (sessionID: string, signal?: AbortSignal) => request<Session>(config, `/session/${sessionID}`, { signal }),

      create: (params?: { title?: string }) =>
        request<Session>(config, "/session", {
          method: "POST",
          body: JSON.stringify(params || {}),
        }),

      delete: (sessionID: string) => request<void>(config, `/session/${sessionID}`, { method: "DELETE" }),

      update: (sessionID: string, params: { title?: string; time?: { archived?: number } }) =>
        request<Session>(config, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify(params),
        }),

      messages: (sessionID: string, params?: { limit?: number }, signal?: AbortSignal) => {
        const query = new URLSearchParams()
        if (params?.limit) query.set("limit", String(params.limit))
        const qs = query.toString()
        return request<MessageWithParts[]>(config, `/session/${sessionID}/message${qs ? `?${qs}` : ""}`, { signal })
      },

      /**
       * One page of a transcript, newest-first from `before` (or from the end
       * when `before` is omitted).
       *
       * `nextCursor` is absent once there is no more history. Prefer this over
       * `messages()` for anything the user can keep scrolling: an unbounded
       * `messages()` on a long session pulls the entire thing into memory —
       * the largest session in this workspace is 1,341 messages / 5,893 parts.
       *
       * The server rejects `before` without `limit` (400), so `limit` is
       * required here rather than optional.
       */
      messagesPage: async (
        sessionID: string,
        params: { limit: number; before?: string },
        signal?: AbortSignal,
      ): Promise<{ items: MessageWithParts[]; nextCursor?: string }> => {
        const query = new URLSearchParams()
        query.set("limit", String(params.limit))
        if (params.before) query.set("before", params.before)
        const { body, headers } = await requestWithHeaders<MessageWithParts[]>(
          config,
          `/session/${sessionID}/message?${query.toString()}`,
          { signal },
        )
        return { items: body, nextCursor: nextCursorFrom(headers) }
      },

      // Sends a message and returns the response
      // Fire-and-forget async prompt - SSE events drive all real-time updates
      prompt: async (
        sessionID: string,
        params: {
          parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>
          model?: { providerID: string; modelID: string }
          agent?: string
          variant?: string
        },
      ): Promise<void> => {
        const url = `${config.baseUrl}/session/${sessionID}/prompt_async`
        const headers = createHeaders(config)
        const body = JSON.stringify(params)
        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body,
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Failed to send message: ${response.status} - ${error}`)
        }
      },

      command: async (
        sessionID: string,
        params: {
          command: string
          arguments: string
          agent?: string
          model?: string
          variant?: string
          parts?: Array<{ type: "file"; mime: string; url: string; filename?: string }>
        },
      ): Promise<void> => {
        const url = `${config.baseUrl}/session/${sessionID}/command`
        const headers = createHeaders(config)

        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...params, sessionID }),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Failed to run command: ${response.status} - ${error}`)
        }
      },

      abort: (sessionID: string) => request<boolean>(config, `/session/${sessionID}/abort`, { method: "POST" }),

      // Compact the session's context: the server summarizes the transcript
      // with the given REAL model (never the swarm facade — see
      // src/lib/summarize-model.ts) and continues from the summary.
      summarize: (sessionID: string, params: { providerID: string; modelID: string }) =>
        request<boolean>(config, `/session/${sessionID}/summarize`, {
          method: "POST",
          body: JSON.stringify(params),
        }),

      diff: (sessionID: string, messageID?: string) => {
        const qs = messageID ? `?messageID=${messageID}` : ""
        return request<unknown[]>(config, `/session/${sessionID}/diff${qs}`)
      },

      // Marks messageID (and everything after it) as pending revert. The
      // underlying messages aren't deleted until the next prompt runs
      // cleanup, or the revert is undone with unrevert() below.
      revert: (sessionID: string, messageID: string, partID?: string) =>
        request<Session>(config, `/session/${sessionID}/revert`, {
          method: "POST",
          body: JSON.stringify(partID ? { messageID, partID } : { messageID }),
        }),

      unrevert: (sessionID: string) =>
        request<Session>(config, `/session/${sessionID}/unrevert`, {
          method: "POST",
        }),
    },

    permission: {
      list: (signal?: AbortSignal) =>
        request<Array<{ id: string; sessionID: string; tool: string; input: unknown }>>(config, "/permission", { signal }),

      reply: (requestID: string, reply: "once" | "always" | "reject") =>
        request<boolean>(config, `/permission/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ reply }),
        }),
    },

    question: {
      list: (signal?: AbortSignal) =>
        request<Array<{ id: string; sessionID: string; questions: unknown[] }>>(config, "/question", { signal }),

      reply: (requestID: string, answers: string[][]) =>
        request<boolean>(config, `/question/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ answers }),
        }),

      reject: (requestID: string) =>
        request<boolean>(config, `/question/${requestID}/reject`, {
          method: "POST",
        }),
    },

    agent: {
      list: () => request<Agent[]>(config, "/agent"),
    },

    command: {
      list: () => request<Command[]>(config, "/command"),
    },

    skill: {
      // Populates the role picker, so creating a swarm from a skill is a
      // choice rather than remembering an exact name.
      list: () => request<SkillInfo[]>(config, "/skill"),
    },

    // OpencodeX swarm management. Roles are a SET on the swarm, not
    // individually addressable rows: update() replaces the whole array, which
    // is how a role is removed (there is no per-role DELETE, and the GUI does
    // the same). See src/lib/swarm-crud.ts for the guard that stops a partial
    // array from silently deleting roles.
    swarm: {
      list: () => request<SwarmInfo[]>(config, `${OPENCODEX_ROOT}/swarm`),
      get: (swarmID: string) => request<SwarmInfo>(config, `${OPENCODEX_ROOT}/swarm/${swarmID}`),
      create: (input: { projectID?: string; title?: string; prompt?: string; roles?: SwarmRoleInput[] }) =>
        request<SwarmInfo>(config, `${OPENCODEX_ROOT}/swarm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      update: (swarmID: string, input: { title?: string; roles?: SwarmRoleInput[] }) =>
        request<SwarmInfo>(config, `${OPENCODEX_ROOT}/swarm/${swarmID}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      // Some server builds refuse the bulk roles array with a bare 400 and
      // only accept these per-role writes. See src/lib/swarm-crud.ts for the
      // fallback that decides between the two contracts.
      addRole: (swarmID: string, role: SwarmRoleInput) =>
        request<SwarmInfo>(config, `${OPENCODEX_ROOT}/swarm/${swarmID}/role`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }),
      updateRole: (swarmID: string, roleID: string, input: Partial<SwarmRoleInput>) =>
        request<SwarmInfo>(config, `${OPENCODEX_ROOT}/swarm/${swarmID}/role/${roleID}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      delete: (swarmID: string) =>
        request<boolean>(config, `${OPENCODEX_ROOT}/swarm/${swarmID}`, { method: "DELETE" }),
    },

    provider: {
      list: () =>
        request<{
          all: Array<{
            id: string
            name: string
            models: Record<
              string,
              {
                id: string
                name: string
                attachment: boolean
                reasoning: boolean
                tool_call: boolean
                cost?: { input: number; output: number }
                limit: { context: number; output: number }
                status?: "alpha" | "beta" | "deprecated" | "active"
                variants?: Record<string, { reasoningEffort?: string }>
              }
            >
          }>
          default: Record<string, string>
          connected: string[]
        }>(config, "/provider"),
    },

    config: {
      get: () => request<unknown>(config, "/config"),
    },
  }
}

export type Client = ReturnType<typeof createClient>
