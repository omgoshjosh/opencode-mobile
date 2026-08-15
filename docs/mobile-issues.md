# Mobile Client Issue Tracker

Working record for the OpencodeX mobile evaluation. Private to this checkout —
nothing here has been filed publicly unless an entry says so.

Base checkout: `dzianisv/opencode-mobile` @ `a750e1b` (local clone, not a GitHub fork).
Evaluation APK: `cc.agentlabs.opencode`, versionName `0.4.12`, custom evaluation signing key.

Devices:
- **Pixel 3 XL** — Android 12, daily carry, EOL. Primary compatibility target.
- **Pixel 8 Pro** — modern reference, tethered to the Mac mini, kept protected.
- **Emulator** — `system-images;android-31;google_apis_playstore;arm64-v8a` (Android 12 + Gboard).

## BLOCKERS — waiting on Josh

Tracked here so they stay visible. Work continues around them; none of these
stop other progress.

| # | Blocker | Why it needs you | Cost if left |
|---|---|---|---|
| B‑1 | **Keyboard padding polish** on Pixel 3 XL | Needs instrumentation on the physical device — notch + gesture nav differ from the emulator, and the emulator cannot reproduce it. Attempted blind twice; both broke the composer and were reverted. | Cosmetic only. Composer is visible and usable. |
| B‑2 | **Actions cannot create PRs** | Repo setting: Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests". | Daily sync pushes the branch but can't open the PR. Now warns instead of failing. |
| B‑3 | **M‑9: swarm drops image attachments** | Server-side fix in OpencodeX (`prompt-swarm.ts` + `claude-driver.ts`), a different repo. Needs your go-ahead on scope. | Images silently never reach a Claude-orchestrated swarm. Workaround: switch off the swarm model, or ask and the image can be read from the DB. |
| B‑4 | **Upstream PR #182 review** | Not actionable by us — waiting on the maintainer. | Three Android fixes unmerged upstream. Ours already carry them. |

---

Status legend: `OPEN` · `FIX-IN-BUILD` (fixed upstream, present in our APK, unverified on device) ·
`FIXED-VERIFIED` · `WONTFIX` · `EXTERNAL`

---

## M-1 — Composer/keyboard hidden behind Gboard `FIXED-VERIFIED`

**Root cause found by measurement, 2026‑08‑15 — a coordinate-space mismatch, not a
wrong `behavior` value.**

`KeyboardAvoidingView` computes
`padding = frame.y + frame.height − (keyboardFrame.screenY − keyboardVerticalOffset)`.
`frame` comes from its own `onLayout`, in **window** coordinates (origin below the
status bar). `keyboardFrame.screenY` is in **screen** coordinates (true top of the
display). Before Expo's mandatory edge-to-edge those origins coincided; under
edge-to-edge they differ by exactly the status-bar inset, so the padding comes up short
by that amount.

Measured on the Android 12 emulator (Pixel 3 XL profile, scale 3.5) with the keyboard
open on the session screen:

| quantity | dp |
|---|---|
| screen height | 845.71 |
| **window** height | 748.86 |
| `insets.top` / `insets.bottom` | 48.86 / 48 |
| keyboard `screenY` / height | 511.71 / 286 |
| computed padding | `748.86 − 511.71 = 237.14` |
| **required** padding | **286.00** |
| **shortfall** | **48.86 → exactly `insets.top`** |

48.86 dp × 3.5 = **171 px**, which is the composer row — hence "the input box is
invisible".

**Why three previous attempts failed.** #53→PR#70, #147→PR#148 (`6c103ac`), and the
closed PR#74 each changed only the `behavior` prop (`"height"` removed, then
`undefined` → `"padding"`). None touched the coordinate mismatch, so the bug kept
returning under a new issue number. **The symptom was reproduced on a build that already
contained `6c103ac`.**

**Fix.** `src/lib/keyboard-offset.ts` — `keyboardVerticalOffset(platform, insetTop)`
returns the existing empirical 90 on iOS (which has no such mismatch) and `insets.top`
on Android, clamped at 0 so a bogus inset can never push content *down*. Applied in
`app/session/[id].tsx`. 5 unit tests, including one that asserts the corrected
arithmetic lands exactly on the real keyboard height. Suite: 242 passing.

**Verified on device.** Keyboard open on a real session: composer text field (with
cursor), attachment button, clipboard button and mic are all visible and usable above
the keyboard, with the agent/model toolbar above them.

- **Portrait:** pass.
- **1.5× font scale:** pass — still fully visible and usable.
- **Landscape:** not applicable; `app.json` sets `"orientation": "portrait"`.

**Contributed upstream (2026‑08‑15).**
[PR #182](https://github.com/dzianisv/opencode-mobile/pull/182), branched cleanly from
`upstream/main` (v0.4.15) with only this fix — 3 files, no evaluation/swarm/pipeline
work included. Typecheck clean, 291 tests pass against upstream's current suite. A
diagnosis comment was posted on
[#156](https://github.com/dzianisv/opencode-mobile/issues/156#issuecomment-5303044943)
asking both reporters to confirm on hardware with a different status-bar height or
gesture navigation — the one case an emulator cannot settle.

---

## M-1 (original triage notes) `SUPERSEDED`

**Symptom.** With the keyboard open, the text field, attachment controls and send
button are not visible. Reported on Pixel 3 XL / Android 12.

**Upstream.** [`dzianisv/opencode-mobile#156`](https://github.com/dzianisv/opencode-mobile/issues/156)
— open, filed 2026‑07‑31, screenshot attached. A second reporter confirms:
*"Main element is not visible. So the whole app is pain. Even on official screenshots
this problem persists."* So this is **not** device-specific to the Pixel 3 XL.

**Prior fix, and why it is probably incomplete.** Commit `6c103ac`
"fix(ui): keep toolbar visible above keyboard (closes #147)" landed **2026‑07‑24**.
It switched `app/session/[id].tsx`'s `KeyboardAvoidingView` from `behavior={undefined}`
to `behavior="padding"` on both platforms, because Expo's mandatory edge-to-edge
display made the manifest's `adjustResize` a no-op.

Issue #156's screenshot is dated **2026‑07‑27** and the issue was filed **07‑31** —
after that fix. Either the fix is incomplete, or it regressed, or it does not cover
this screen/inset path. Root cause is therefore **not yet established**.

**Candidate layers to bisect** (do not assume the CSS/JS layer):
1. native window insets under edge-to-edge,
2. `KeyboardAvoidingView` JS-measured keyboard height,
3. `SafeAreaView` / inset provider nesting,
4. the inverted `FlatList` content inset.

**Next action.** Reproduce on the API 31 emulator with Gboard, then on the Pixel 3 XL.
Acceptance: composer + attachment controls + send remain visible and usable with the
keyboard open, in portrait, landscape, and at increased display/font scaling.

---

## M-2 — Assistant message text cannot be selected or copied `FIXED-VERIFIED`

**Symptom.** Text in assistant replies cannot be selected, so it cannot be copied.

**Root cause — found, and it is deliberate.** `src/components/markdown/Markdown.tsx`
defines a `CustomRenderer` that overrides every plain-text node
(`text`/`strong`/`em`/`del`/`heading`/`codespan`) specifically to **drop the
`selectable` prop** that `react-native-marked`'s base `Renderer` hardcodes.

The in-code justification: on Android, a `selectable` `<Text>` nested inside a
`FlatList` row hits [`facebook/react-native#46999`](https://github.com/facebook/react-native/issues/46999)
(a reopened regression of #28952), where selectable state — and the component's
exposure to the accessibility tree Maestro/UiAutomator reads — never applies
correctly. Chat messages *are* rows of the session screen's inverted `FlatList`,
so every markdown text node hits it.

The comment concludes *"Code content is still copyable via CodeBlock's explicit Copy
button, so dropping `selectable` on plain text costs little."* That tradeoff is the
bug from a user's perspective: **prose in assistant replies has no copy path at all.**

**Current copy coverage:**

| Content | Copyable? | How |
|---|---|---|
| User message text | Yes | `<Text selectable>` in `MessageBubble.tsx:90` |
| Fenced code blocks | Yes | `CodeBlock.tsx` explicit Copy button (`expo-clipboard`) |
| Tool call output | Yes | `<Text selectable>` in `ToolCallCard.tsx` |
| **Assistant prose / markdown** | **No** | — |

Note the inconsistency: user text and tool output *do* use `selectable` inside the
same FlatList, so the RN bug is either not universal or is being tolerated there.

**Upstream.** No issue exists. Searched `dzianisv/opencode-mobile` open + closed.

**Reproduced.** Android 12 emulator (`opencodex_android12`, API 31 + Play/Gboard),
evaluation APK, demo conversation. Long-pressing assistant prose produces no selection
handles, no context menu, no action sheet.

**VERIFIED FIXED on device, 2026‑08‑15**, in a real session against the live hub:
long-press an assistant message → "Message actions" sheet offers **Copy message** and
**Select text** (and correctly omits "Edit message", which stays user-only) → Select
text opens the modal → long-press inside it produces **selection handles plus Android's
native Copy / Share / Select all menu**. Partial selection of assistant prose now works.

**Fix implemented** (this checkout, not yet device-verified):

- `src/lib/message-copy-text.ts` — pure `extractCopyText` / `extractReasoningText` /
  `hasCopyableText` over a message's parts. 8 unit tests.
- `src/components/chat/SelectableTextModal.tsx` — renders the source text in a
  `selectable` `<Text>` inside a `<Modal>`. The modal is the whole point: it renders
  outside the transcript FlatList, so RN#46999 does not apply and real partial
  selection works. Includes a "Copy all" button.
- `src/components/chat/MessageBubble.tsx` — long-press enabled for **both** roles
  (was user-only).
- `app/session/[id].tsx` — the action sheet now offers "Copy message" and
  "Select text" for either role, keeping "Edit message" user-only. Returns early
  when a message has no prose, so tool-only messages don't open an empty sheet.
- i18n strings added to `en.json` and `zh-Hans.json` (catalog-parity test enforced).

Suite: 227 passing (was 219). `tsc --noEmit` clean.

**Known gap.** `app/demo.tsx` renders `MessageBubble` **without** `onLongPress`, so
text in the demo conversation is still uncopyable. The demo is the first thing a new
user sees. Worth wiring the same modal there — deliberately left out of this change
to keep it reviewable.

---

## M-3 — Open session does not live-update; stuck spinner `FIX-IN-BUILD`

**Symptom.** A prompt submitted from the CLI does not appear in an already-open
mobile session until the session is left and re-entered.

**Upstream fix, already in our APK.** Commit `616753b`
"fix(sessions): live-update open session screen; clear stuck loading without re-nav
(closes #150)", landed 2026‑07‑24 — after the `0.4.12` release tag, so it is **not**
in any published Play build but **is** in our evaluation APK.

Root cause per that commit: `selectSession()` re-ran on every navigation focus,
forcing `isLoading` back to `true` even when re-selecting the session already on
screen — hiding messages and composer behind a spinner while live SSE updates kept
flowing into the store unseen. Fixed via `isColdSessionLoad()` plus an
`isLiveEventForSession()` proof-of-life escape hatch. Both unit-tested in
`src/lib/session-load-reconcile.ts`.

**Caveat.** This is a *client rendering* fix. It does not address M-4, which can
produce the same user-visible symptom for an entirely different reason. Verify both.

---

## M-4 — Split live event buses (server side) `RESOLVED` (2026-08-15)

**Not a mobile-client bug.** Recorded here because it produces a symptom
indistinguishable from M-3.

**Resolved.** As of 2026‑08‑15 only one process holds the port:

```
$ lsof -iTCP:4096 -sTCP:LISTEN
opencodex 92690  TCP *:4096 (LISTEN)   # launchd hub, now authoritative
```

The TUI coordinator on `127.0.0.1:4096` is gone, so loopback and LAN/Tailscale clients
share one event bus. Realtime results are trustworthy again. Watch for regression: the
coordinator reappearing on 4096 silently reintroduces this.

**Historical — active on this Mac, 2026‑08‑12:**

```
$ lsof -iTCP:4096 -sTCP:LISTEN
opencodex   189  TCP 127.0.0.1:4096 (LISTEN)   # internal-tui-coordinator /Users/josh
opencodex 66894  TCP *:4096        (LISTEN)   # serve --hostname 0.0.0.0 --port 4096
```

Both processes are up (coordinator since Aug 11 23:02, hub since Aug 11 20:10). Any
mobile client reaching the Mac over LAN/Tailscale lands on PID 66894; anything on
loopback lands on PID 189. **Until this is resolved, any mobile realtime test is
measuring the wrong thing** — a "stale session" result cannot be attributed to the
client. Resolve this before running M-3 verification.

Two OpencodeX servers were listening on port 4096 simultaneously: the TUI coordinator
on `127.0.0.1:4096`, and the launchd hub on `0.0.0.0:4096` for LAN/Tailscale clients.
Both opened the same SQLite database, but `/global/event` fanout is **process-local**.
Loopback clients received coordinator events; mobile clients received hub events.
Persisted messages became visible to either process only on transcript refetch.

No `workspace` rows existed and the affected session had no `workspace_id`, so the hub
adapter bridged nothing. Servers emitted 10s heartbeats; no server-side SSE idle
timeout was found.

**Remediation.** Make one process authoritative, or explicitly configure and attach the
hub workspace. Do **not** point a local hub adapter at `127.0.0.1:4096` while the
coordinator owns that address — use the LAN or Tailscale address so it reaches the
launchd hub.

Detail: `/Users/josh/agents/worktrees/cross-client-realtime-contract/CROSS_CLIENT_REALTIME_CONTRACT.md`
(commit `a3ecc8f`; related `116a82f`, `4139943`). Server-side contract itself **passes**
on ecgreen `main` — an already-connected `/global/event` subscriber does receive another
client's prompt immediately, without refetch.

---

## M-6 — No transcript reconciliation after SSE reconnect `FIXED-VERIFIED`

**This is the client-side gap the realtime contract doc predicts but does not name.**
The server contract passes (an already-connected `/global/event` subscriber does get
another client's prompt immediately), so the doc narrows the stale-session symptom to
"the client or transport path". Here is the specific hole.

**The chain:**

1. SSE reconnect resumes the stream from *now*. It does **not** replay missed events —
   stated explicitly in `src/stores/events.ts:93-98`.
2. The only reconnect-time reconciliation is `resyncBusySessions()`, invoked once per
   reconnect at `events.ts:232-235`.
3. `resyncBusySessions()` filters to sessions whose store status is `busy` and
   **returns immediately if none are** (`events.ts:105-109`).
4. Mobile only learns a session is busy from a `session.status` SSE event. If mobile was
   disconnected when the other client's prompt arrived, **it never saw that event**, so
   the session is still `idle` in its store.
5. Therefore `resyncBusySessions()` no-ops, nothing refetches, and the open transcript
   stays stale until the user navigates away and back (which triggers `selectSession`).

The session screen subscribes to `reconnectAttempts` (`app/session/[id].tsx:143`) but
uses it **only** to render the reconnect/connected banner (lines 512-522, 675-683).
No effect refetches messages when the connection is restored.

**Why this survived the M-3 fix.** `616753b` fixed a *rendering* bug — a spinner hiding
content that was arriving. This is a *data* bug: the content never arrives at all. Same
user-visible symptom, different layer. The two are complementary, not duplicates.

**Proposed fix.** In the `isReconnect && !resyncedAfterReconnect` block, also refetch
the currently-open session's transcript unconditionally, not just busy ones. One GET on
a relatively rare event. This composes well with `616753b`: because that change stopped
same-session refreshes from forcing `isLoading`, the refetch lands as a silent
background reconcile with no spinner flash.

**Implemented** in `reconcileOpenSession()` (`src/stores/events.ts`), invoked alongside
`resyncBusySessions()` in the same once-per-reconnect block. Typecheck clean, 227 tests
pass.

**VERIFIED end-to-end on device, 2026‑08‑15.** Android 12 emulator (API 31) running the
evaluation APK, connected to the launchd hub at `10.0.2.2:4096`, against a throwaway
session (`M6 reconnect test`, deleted afterwards):

| Step | Action | Result |
|---|---|---|
| 1 | Post `SEED-BEFORE-DISCONNECT` via `POST /session/:id/message` while connected | Appeared live — baseline SSE delivery works |
| 2 | `cmd connectivity airplane-mode enable` | Banner: "Reconnecting… (attempt 5)" |
| 3 | Post `SENT-WHILE-MOBILE-OFFLINE` from the host while mobile is offline | **Not** shown on device — reproduces the bug's precondition |
| 4 | `airplane-mode disable`, wait ~35s, **do not navigate** | Message **backfilled automatically**; banner cleared; no spinner |

Step 4 is the regression check: before this fix the transcript stayed stale until the
user left the session and re-entered. `noReply: true` was used throughout so the test
exercises prompt acceptance/persistence and realtime delivery without model timing.

---

## M-7 — Swarm selection does not persist; must be reselected every message `FIXED-VERIFIED`

Source: `/Users/josh/agents/OPENCODEX_MOBILE_SWARM_SELECTION_HANDOFF_2026-08-14.md`.

**Symptom.** Select a swarm, send a prompt, and the next prompt has silently left
swarm mode — the user must reselect the swarm before *every* message.

**Root cause.** A swarm is a synthetic provider: the session persists
`session.model = { providerID: "swarm", id: <swarmID> }` as a *facade*, while the
orchestrator executes on a concrete model and each assistant message records that
**resolved execution identity** (e.g. `openai/gpt-5.6-sol`).

`app/session/[id].tsx` synced its model chip from the latest assistant message. So one
swarm reply overwrote the `swarm/<id>` selection with `openai/gpt-5.6-sol`; the next
prompt was sent as that concrete model, which **re-persists `session.model` server-side**
and drops the session out of swarm mode for good.

Three compounding gaps in mobile:
1. `Session` in `src/lib/sdk.ts` had **no `model` field at all**, so there was nothing to
   restore from.
2. Nothing treated `swarm/<id>` as a first-class, non-overridable selection.
3. Shape mismatch: the server persists `{ providerID, id }`, while messages and the
   catalog store use `{ providerID, modelID }`.

The desktop GUI never had this bug — it restores from persisted `session.model`
(`packages/gui/src/renderer/src/lib/model-selection.ts`, `sessionModelDefaults`).

**Fix.**
- `src/lib/swarm-model.ts` — `SWARM_PROVIDER_ID`, `isSwarmSelection`,
  `sessionModelSelection` (normalizes `id` → `modelID`), and `resolveSessionModel`
  encoding the precedence: a persisted swarm always wins; otherwise the
  conversation-derived model; otherwise the persisted model (cold open / reload);
  otherwise null so the caller leaves the selection untouched.
- `src/lib/sdk.ts` — added the missing `Session.model` field.
- `app/session/[id].tsx` — the sync effect now routes through `resolveSessionModel`
  and re-runs when the session's persisted model changes.

10 unit tests, including the specific regression (swarm survives a Sol- or Terra-backed
reply) and the conservative cases (ordinary sessions still follow the conversation; a
deliberate switch away from a swarm is not blocked). Suite: 237 passing. Typecheck clean.

**Contract verified against the live server**, confirming mobile's payload shape is
accepted and the facade persists:

```
POST /session/:id/message  {"model":{"providerID":"swarm","modelID":"swm_0043…"}}  → 200
GET  /session/:id          → model = {"providerID":"swarm","id":"swm_0043…"}
```

**VERIFIED on device, 2026‑08‑15.** Test session `Opencodex reliability team`
(`ses_0010171e0ffe4FwMJ5nitsKznn`) is ideal: persisted as
`swarm/swm_ffefa457c001emtwoJaqlAMiB1`, but **all 472 of its assistant messages record a
concrete execution model** (`openai/gpt-5.6-luna`, `openai/gpt-5.6-sol`,
`opencode/deepseek-v4-flash-free`) — precisely the input that used to clobber the facade.

A temporary in-app diagnostic confirmed the resolution directly:

```
sessionModel=undefined  fromMessages=null                                   resolved=null
sessionModel={"id":"swm_ffefa457…","providerID":"swarm"}
                        fromMessages={"providerID":"opencode",
                                      "modelID":"deepseek-v4-flash-free"}   resolved={"providerID":"swarm",…}
```

The first line also validates the null-guard: with nothing authoritative loaded yet the
selection is left alone rather than cleared. After removing the diagnostic and
rebuilding, the composer chip renders `swm_ffefa457c001emtwoJ…` — the swarm — while the
visible replies are `deepseek-v4-flash-free`.

**Residual risk.** One earlier observation on the same build showed `gpt-5.6-sol` in the
chip before instrumentation was added; it did not reproduce afterwards and the logged
resolution is unambiguous. Possibly a transient pre-load render. Worth one more look if
the symptom is ever reported again.

**Not done (acceptance criterion 6):** swarms still render as generic models in the
picker rather than carrying a swarm/team label. Cosmetic, separable from persistence.

---

## M-8 — Sessions page: group-by picker (swarm, status, date, directory) `BACKLOG`

Requested 2026-08-15, design refined same day. Queued; not started.

**Goal.** Show which swarm a session belongs to and its live status, and let the user
choose how the list is grouped instead of hardcoding directory grouping.

### Design: one nesting layer + a single-select "Group by" picker

Rejected double nesting. Two independent collapse dimensions on a phone is hard to read
and hard to operate, and it doubles the state to persist. One layer plus a picker gets
the same value.

**The key realisation:** *grouping by swarm root session **is** the nesting.* Choosing
"Swarm root session" puts each root's children under it — the originally requested
nested view — without building a tree, a second collapse dimension, or recursive
rendering. Nesting becomes a grouping mode rather than a structural change.

Proposed modes:

| Mode | Key | Notes |
|---|---|---|
| Directory / project | `session.directory` | Current behaviour; stays the default |
| Swarm | `session.model.providerID === "swarm" ? session.model.id : "(no swarm)"` | Header shows the team name via `modelDisplayLabel()` |
| Swarm root session | `session.parentID ?? session.id` | **This is the nested view** — children grouped under their root |
| Date | bucketed `time.updated` | Today / Yesterday / This week / Older |
| Status | `useEvents().sessionStatus[id].type` | Busy first — the "what's running?" view |

### Implementation notes (survey done 2026-08-15)

- **`src/lib/session-grouping.ts` already does the hard part.** `groupByDirectory` is a
  pure, first-seen-order bucketer with no React Native imports. Generalize it to
  `groupBy(items, keyFn)` and keep `groupByDirectory` as a thin wrapper — small,
  mechanical, and existing tests keep covering the old path.
- `app/(tabs)/index.tsx` already flattens groups into typed rows
  (`{ type: "header", … }` + session rows) for a single FlatList, with collapse state in
  `collapsedDirs: Set<string>`. That generalizes to `collapsedGroups` keyed by group key.
  **The expand/collapse machinery exists; this adds a key function, not a mechanism.**
- Swarm display names already resolve via `modelDisplayLabel()` (`swm_…` → "Fable Bowser
  Dev Team"). Live status already lives in `useEvents().sessionStatus`.
- Persist the chosen mode (and collapse state) so it survives app restarts.

### The one real obstacle

`src/lib/session-list.ts:38` currently discards child sessions outright:

```ts
if (params?.roots) out = out.filter((s) => !s.parentID)
```

Swarm role/subagent sessions carry `parentID`, so they never reach the list. The
"Swarm root session" mode needs them kept. Note the desktop GUI made the same choice
deliberately (`swarmSessions()` keeps only top-level sessions), so this is a decision to
revisit rather than an oversight — the flat "recent sessions" view depends on it and
must not regress. Likely answer: keep children in the data and let the *grouping mode*
decide whether to show them, rather than filtering at fetch time.

### Suggested slices

1. **Status + swarm badge on existing rows.** Pure presentation, no data-model change,
   no picker. Ships the "what's running / which team" value immediately.
2. **Generalize `groupBy` + add the picker** with Directory, Swarm, Date, Status — all
   modes that work on already-fetched top-level sessions.
3. **Swarm root session mode**, which is the only slice that needs the `parentID` filter
   revisited, and so carries the regression risk. Doing it last keeps 1 and 2 shippable
   independently.

### Decided 2026-08-15

**Header status = deduped, non-empty status counts.** A row of small badges, one per
status actually present, each with a count — e.g. `3 busy · 1 retry`. Statuses with a
zero count are omitted entirely rather than rendered as `0 idle`, so a quiet group shows
one badge (or none) instead of a row of noise. Counts come from
`useEvents().sessionStatus` over the group's members. Pure and unit-testable:
`statusCounts(sessions, sessionStatus) -> Array<{status, count}>`, sorted busy → retry →
idle so the attention-worthy state reads first.

**Child sessions are openable.** They render as ordinary rows and route to the same
session screen; no read-only mode unless a concrete conflict appears.

**Risk to verify before shipping that** (do not assume): opening a child is certainly
safe, but *prompting into* a subagent session while its orchestrator is mid-run is
untested here. The concern is two writers on one session — the orchestrator driving the
child, and the user typing into it — and how the parent reconciles a transcript it did
not author. Check server-side behaviour first; if it is unsafe, the fallback is to keep
children openable but suppress the composer while the parent session is busy, which
preserves the useful part (reading what a role is doing) without the hazard.

### Open questions

- Where does the picker live: header dropdown, or a segmented control under the title?
- Should "(no swarm)" / "(no parent)" sort first or last?

## M-9 — Image attachments silently dropped on swarm sessions `OPEN` — server-side (OpencodeX)

Reported 2026-08-15: a screenshot attached in the mobile app appeared to send, but never
reached the assistant.

**Not a mobile bug.** The client is correct end to end: `toJpeg()` converts the picked
image, `sendMessage` builds `{ type: "file", mime, url: "data:image/jpeg;base64,…",
filename }`, and posts it to `/session/:id/prompt_async`. The part **persists correctly**
— confirmed by reading the session back from the server (valid JPEG data URL, ~176 KB).

**Evidence — it only fails on swarm sessions.** Every file part ever sent in the session
`ses_00b4e09feffet9OvqhADPtYfY2`:

| Sent | Session model | Reached the assistant? |
|---|---|---|
| 08‑12 23:30 | `opencode-go/kimi-k3` | yes |
| 08‑13 23:57 | `openai/gpt-5.6-luna` | yes |
| 08‑15 10:15 | `swarm/swm_0043e3dd…` | **no** |
| 08‑15 10:44 | `swarm/swm_0043e3dd…` | **no** |
| 08‑15 13:52 | `swarm/swm_0043e3dd…` | **no** |

**Root cause.** `packages/opencode/src/session/prompt-swarm.ts` (~line 276). When the
orchestrator is Claude Code, the user message is flattened to text and everything else is
discarded:

```ts
const text = last.parts
  .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []))
  .join("\n")
  .trim()
if (!text) return undefined
...
return claudeDriver.runTurn({ sessionID, parentMessageID, text, ... })
```

It is structural rather than an oversight in that filter:
`packages/opencode/src/opencodex/claude-driver.ts` defines `runTurn` with **`text: string`
as its only content channel** — there is no attachments field, so file parts cannot be
carried even if the filter kept them.

**Fix sketch (server-side, not mobile):**
1. Add an attachments field to `runTurn`'s input.
2. Stop discarding non-text parts in `prompt-swarm.ts`.
3. Materialize each `data:` URL to a temp file in the session directory and reference it
   in the prompt the Claude CLI receives — the CLI takes image *paths*, not inline base64,
   so a straight pass-through will not work.
4. Clean the temp files up after the turn.

**Silent failure is the worst part.** The prompt succeeds, the part persists, the UI shows
the image attached — and the model simply never sees it. At minimum the swarm path should
surface a warning when it drops non-text parts, so the user isn't left wondering.

**Workaround until fixed:** switch the session to a non-swarm model when sending an image.

---

## M-10 — "New session" button reported broken `NEEDS REPRO`

Reported 2026-08-15. **Could not reproduce on the Android 12 emulator** against the
live server, on build 29780499:

1. Tap the + FAB → a session is created and the app navigates into it
2. Composer accepts text
3. Send → assistant replies ("Pong.") and the turn is attributed to
   "Fable Bowser Dev Team"

So the happy path works. What differs on Josh's device is unknown; likely candidates,
none confirmed:

- **He is on an older build.** He has not updated App Tester since several fixes landed;
  the behaviour may already be different.
- **Directory/project state.** The FAB calls `createSession()` with no directory, so the
  session lands in the active connection's directory. On the emulator that resolved to
  `agents`. A connection with no/invalid directory may behave differently.
- **Long-press vs tap.** Tap creates immediately; long-press opens the new-session modal
  with a project picker (`onFabLongPress`). If the modal is what is broken, that is a
  different code path entirely.

**One real defect spotted while reading the path** (not necessarily the reported one):
`createSession()` sets `currentSession`/`messages` but never clears the store's `error`,
so a stale error banner from a previous failure survives into a brand-new session.

**Needed from Josh to proceed:** what "broken" looks like — nothing happens, an error
appears, it opens then fails to send, or it opens the wrong directory. A screenshot is
enough; images can be recovered from the DB even though the swarm path drops them.

---

## M-5 — Messages do not auto-scroll `OPEN`

**Upstream.** [`dzianisv/opencode-mobile#155`](https://github.com/dzianisv/opencode-mobile/issues/155)
— open, filed 2026‑07‑26, not yet triaged here. Likely interacts with the inverted
`FlatList` in M-1/M-2. Flagged so it is not mistaken for a symptom of those.

---

## Build & distribution

Pipeline built in the prior session; see `docs/evaluation-builds.md`.

- `scripts/build-evaluation-apk.sh` — one-command locally signed build
- `.github/workflows/distribute-evaluation.yml` — manual Firebase App Distribution
- Signing key held outside the repo; 219 tests passing at build time

**Blocked on approval:** creating a private repo + Firebase app, configuring secrets,
inviting the phone's Google account. First install will likely require uninstalling the
Play-Store build (different signing key), which erases that app's local settings.
