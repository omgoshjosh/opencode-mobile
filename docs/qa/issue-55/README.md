# #55 composer draft autosave — red/green evidence

Command (both runs):

    node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 src/lib/draft-autosave.test.ts src/stores/drafts-55.integration.test.ts

- `regression-red.log`: head `d2648ff` plus only the two new test files. Exit 1, 1/10 pass. The pass is
  "a draft survives a cold start and a reopen", which the existing store already did (kept as coverage).
  The failures: no debounce/flush/send-token controller; a save before hydration wiped other sessions'
  stored drafts; deleting a session kept its draft; `sendMessage` resolved `undefined` (not `false`) when
  nothing was sent.
- `regression-green.log`: with the fix. Exit 0, 10/10.

Send-ack path: `handleSend` → `useSessions.sendMessage` → `client.session.prompt` →
`POST /session/:id/prompt_async`, awaited; resolves only on a 2xx response, throws otherwise
(`src/lib/sdk.ts`). Slash commands await `session.command`, and `/compact` awaits `session.summarize`.
Before this change the draft was cleared before any of those calls was made.

Kill / OS eviction: best effort. At most the last ~1 s of typing (one debounce window) can be lost,
plus anything AsyncStorage had not flushed. Not a crash guarantee.

Native UI wiring (`app/session/[id].tsx`) is covered by typecheck only; device QA is separate.
