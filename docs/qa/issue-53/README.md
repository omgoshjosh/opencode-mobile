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

## Review round 2 (PR #54 review 5962102961)

Command (both runs):

    node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 src/lib/list-worker-summary-r2.test.ts src/stores/worker-chip-53-r2.integration.test.ts

- `regression-red-r2.log`: clean `git archive aea4579` plus only the two new test files. Exit 1, 0/7:
  depth-40 worker 0 (expected 1), unplaced worker not reported, numeric overlap 4 (expected 2), terminal
  aggregate job 1 (expected 0), no hint label, failed manager lookup recorded as a root / never recovered,
  pending lookup not reported.
- `regression-green-r2.log`: with the round-2 fix. Exit 0, 7/7.
The round-1 logs above are unchanged.
