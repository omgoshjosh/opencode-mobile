# #53 worker chip regression — red/green evidence

Command (both runs):

    node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 src/stores/worker-chip-53.integration.test.ts

- `regression-red.log`: base `ce8f5c7` (fork/deploy) plus only the behavior-neutral extraction of the
  list row selector into `src/lib/list-worker-summary.ts` (same `backgroundFor` + `workerStatesFor`
  logic the row hook ran). Exit 1, 0/4 pass: idle root with busy non-background child → 0, grandchild
  under idle manager → 0, nested count 1 instead of 2, reconnect restore → 0.
- `regression-green.log`: with the fix. Exit 0, 4/4 pass.

Live evidence (daemon `0.0.0-dogfood-stack2-5a3a7f3-202609231712`, read-only DB, Oct 2 ~11:05 PDT):
`OpencodeX mobile 9/20` (idle) → Bowser Jr manager (idle) → Goomba worker (busy); `Yondi ci 9/29` (idle)
→ Bowser Jr (busy). Neither worker carries `metadata.opencodex.delegation.background`, so the daemon
attaches no `background` aggregate to either root. GET `/session/status` needs auth (401); no
credentials were used.
