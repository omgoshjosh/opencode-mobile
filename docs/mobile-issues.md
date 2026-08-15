# Mobile Client Issue Tracker

Working record for the OpencodeX mobile evaluation. Private to this checkout —
nothing here has been filed publicly unless an entry says so.

Base checkout: `dzianisv/opencode-mobile` @ `a750e1b` (local clone, not a GitHub fork).
Evaluation APK: `cc.agentlabs.opencode`, versionName `0.4.12`, custom evaluation signing key.

Devices:
- **Pixel 3 XL** — Android 12, daily carry, EOL. Primary compatibility target.
- **Pixel 8 Pro** — modern reference, tethered to the Mac mini, kept protected.
- **Emulator** — `system-images;android-31;google_apis_playstore;arm64-v8a` (Android 12 + Gboard).

Status legend: `OPEN` · `FIX-IN-BUILD` (fixed upstream, present in our APK, unverified on device) ·
`FIXED-VERIFIED` · `WONTFIX` · `EXTERNAL`

---

## M-1 — Composer/keyboard hidden behind Gboard `OPEN`

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
