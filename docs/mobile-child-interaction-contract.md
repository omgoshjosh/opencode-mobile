# Mobile Child Interaction Contract

Scope: the React Native client in this repository, as implemented on the
`feature/mobile-opencodex-dio-5-child-interaction-contract` base. This is a
client contract, not a prescription for backend changes.

## Sources of Truth

- **Live events:** `src/stores/events.ts` consumes the global SSE stream from
  `src/lib/sdk.ts` (`GET /global/event`). It handles `session.status`,
  `session.created`, `session.updated`, `session.deleted`, `message.updated`,
  `message.removed`, `message.part.updated`, `session.error`, permission, and
  question events.
- **Session list:** `loadSessions()` prefers `session.tree()` and otherwise
  calls `session.list({ roots: true })`. The resulting list is filtered to
  sessions without `parentID` in `src/stores/sessions.ts:385-414`.
- **Expanded children:** `loadSessionChildren(rootID)` calls
  `session.children(rootID)` and replaces the previously loaded children for
  that root (`src/stores/sessions.ts:424-439`).
- **Transcript:** opening or refreshing a session reads paged messages through
  `session.messagesPage()`. SSE parts and message updates are applied only to
  the active transcript; parked child transcripts remain snapshots until that
  child is opened (`src/stores/sessions.ts:249-270`, `1014-1091`).
- **Reconnect snapshots:** status uses `GET /session/status`; the open
  transcript uses one bounded newest message page; session membership uses a
  complete list snapshot. See `src/stores/events.ts:222-239`, `318-360`, and
  `362-377`, plus `src/lib/reconnect-transcript.ts`.
- **Disk snapshots:** last-viewed state, previews, session rows, and status
  are convenience caches. They are labelled/treated as stale and never
  override live or successfully fetched data (`src/stores/sessions.ts:348-383`,
  `src/stores/events.ts:30-43`).

The backend must provide coherent IDs, `parentID` relationships, message/part
IDs, and event payloads. The client does not infer missing child work from
titles or from a parent merely being busy.

## Child and Card Filtering

- A root is a session with no `parentID`.
- The list renders roots first. A child fetched while expanding a root is
  eligible for visible child rows only when its `parentID` matches that root;
  unrelated fetched children are filtered from that response. A
  `session.created` event can still retain a child with an unknown or
  currently non-visible parent in the store, but `session-worker-rows.ts`
  prevents it from rendering as a root. Deleted IDs are removed from the
  visible store (`src/stores/sessions.ts:412`, `424-435`, `1029-1035`,
  `src/lib/session-worker-rows.ts:6-19`).
- `src/lib/session-worker-rows.ts` intentionally exposes direct children only,
  at depth 1. Collapsed children never appear as roots. The hub likewise lists
  direct children only (`app/session-hub/[id].tsx:55-61`); grandchildren are
  reached by opening the child.
- The task tool card is openable only when its metadata contains a non-empty
  `state.metadata.sessionId`. Pending cards are not openable; running,
  completed, and errored cards are (`src/lib/subagent-link.ts:47-76`, `102-110`).
  The card label prefers `description`, then the tool title, then `Subagent`.
- A task's child ID comes from `state.metadata.sessionId`; its status comes
  from the task part. A completed/error task marks that child terminal in the
  event store. Legacy activity fallback excludes terminal children and
  completed task parts (`src/stores/events.ts:587-604`,
  `src/lib/background-activity.ts:78-113`).
- Child navigation uses `/session/[id]` and preserves the child directory.
  The child screen has a breadcrumb route back to its parent
  (`app/session/[id].tsx:1234-1254`). The hub's child and waiting rows use the
  same route (`app/session-hub/[id].tsx:176-281`).

## Replies and Stop Semantics

All routes are addressed by request/session/message ID; a child uses the same
routes as any other session.

| Interaction | Client route and behavior |
|---|---|
| Prompt | `POST /session/:id/prompt_async`; the user message is optimistic, while SSE supplies the authoritative response (`src/lib/sdk.ts:598-622`, `src/stores/sessions.ts:767-824`). |
| Permission | `POST /permission/:requestID/reply` with `once`, `always`, or `reject`. The prompt is removed optimistically and restored if the request fails (`src/lib/sdk.ts:681-690`, `app/session/[id].tsx:965-986`). |
| Question answer | `POST /question/:requestID/reply` with `answers: string[][]`; the same optimistic-remove/rollback rule applies (`src/lib/sdk.ts:692-700`, `app/session/[id].tsx:988-1006`). |
| Question rejection | `POST /question/:requestID/reject`, with the same rollback rule (`src/lib/sdk.ts:702-705`, `app/session/[id].tsx:1008-1026`). |
| Stop current run | `POST /session/:id/abort`. The client marks the run aborted only after a successful request; the later busy-to-idle transition does not count as a completed response (`src/stores/sessions.ts:844-857`, `src/stores/events.ts:519-575`). |
| Cancel queued edit | `POST /session/:id/message/:messageID/cancel`, newest queued messages first. Outcomes are `cancelled`, `running`, `settled`, or `missing`; only cancelled messages are restored to the composer (`src/lib/sdk.ts:579-580`, `src/lib/message-cancel.ts`, `app/session/[id].tsx:529-563`). |

Stop is a client action against the selected session. It does not claim that
descendants stopped unless the server subsequently reports their status or
the parent task becomes terminal. `session.status` is authoritative for
busy/idle/retry; `session.error` suppresses completion accounting but does not
invent a new status variant.

## Reconnect Reconciliation

SSE does not replay the interval before a newly connected stream. On the first
live event after reconnect, the client starts several independent,
best-effort reconciliation operations concurrently: busy sessions are checked
with one bounded newest message page and busy is cleared only when the final
message proves the session is idle (`src/stores/events.ts:305-360`); the open
transcript is reconciled once by merging a bounded page without resetting
pagination or deleting optimistic content (`src/lib/reconnect-transcript.ts:19-31`);
status is hydrated; and one complete session-list snapshot removes rows that
vanished while disconnected, except the currently open session
(`src/stores/events.ts:489-505`, `src/stores/sessions.ts:442-460`).

These operations may overlap and complete in any order. They are best-effort:
failed requests preserve usable state. Lifecycle tokens, transcript revisions,
active-session checks, and single-flight coordination are the correctness
guards, not operation ordering. `resume()` also reconciles the open transcript
even when the SSE socket remained live (`src/stores/events.ts:766-777`).

Live events win over an in-flight GET. Lifecycle tokens, transcript revisions,
the single-flight transcript coordinator, and active-session checks prevent a
late response from overwriting a newer selection or event. Part updates are
coalesced by part ID and the newest part version wins
(`src/stores/sessions.ts:209-305`).

## Idempotency and Compatibility

- Duplicate permission/question asks are ignored by request ID; replies remove
  by request ID, and delete handling clears all associated event state
  (`src/stores/events.ts:658-733`, `203-220`).
- Repeated child loads replace the root's child set rather than append it.
  Repeated transcript reconciliation deduplicates parts by ID and preserves
  existing pagination (`src/lib/reconnect-transcript.ts:20-31`).
- At the SDK boundary, only HTTP 404 is treated as a missing capability.
  `session.tree()` falls back to the root list; live children fall back to the
  plain children route, then to `null`. Non-404 SDK errors are rethrown
  (`src/lib/sdk.ts:499-556`). At the store boundary,
  `loadSessionChildren()` catches every resulting error and preserves the
  usable root without surfacing the error (`src/stores/sessions.ts:424-439`).
- The global experimental session list itself falls back to legacy `/session`
  only on 404 (`src/lib/sdk.ts:461-497`). Message paging retries once without
  `partBudget` when the server rejects that optional parameter, then remembers
  the capability result (`src/lib/message-transport.ts:8-39`).
- These fallbacks are client compatibility behavior. They depend on the
  backend retaining the documented legacy routes and stable response shapes;
  they do not define or require backend implementation changes.

## Deterministic Test Cases

The existing tests are the executable references for these cases:

- `src/lib/sdk-session-worker.test.ts`: live tree 404 falls back to roots;
  live children 404 falls back to plain children; non-404 errors remain
  errors.
- `src/stores/sessions-workers.integration.test.ts`: only matching fetched
  children are rendered in the expanded root list, and a child never becomes
  a root.
- `src/lib/session-worker-rows.test.ts`: collapsed roots hide children and
  direct children render at depth 1.
- `src/lib/subagent-link.test.ts`: missing metadata is non-openable; running,
  completed, and errored task cards are openable; labels and role precedence
  are deterministic.
- `src/stores/reconnect.integration.test.ts`: missed messages are recovered,
  exactly one bounded page is fetched, foreground reconciliation does not
  open a second stream, overlapping reconciliation is single-flight and
  preserves pagination, and live updates beat stale snapshots.
- `src/lib/message-cancel.test.ts` and the queued-edit coverage in
  `app/session/[id].tsx` validate cancellation outcome handling.

For a new deterministic fixture, use two roots (`r1`, `r2`), children
`c1.parentID = r1` and `c2.parentID = r2`, plus an orphan. Assert that loading
`r1` yields `r1,c1` only; assert that a pending task card cannot navigate;
then feed running and terminal task parts and assert the card becomes
navigable and the child leaves the waiting set. Finally disconnect between a
message update and idle, reconnect, and assert one bounded page restores the
message without duplicates or loss of the optimistic prompt.
