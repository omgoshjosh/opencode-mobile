import assert from "node:assert/strict"
import test from "node:test"
import { backgroundFor, backgroundJobRouteParams, compareJobs, mergeStatusEvent, mergeStatusSnapshot, runningWorkerCount, speaksBackground } from "./background-activity.ts"

const parent = "parent"
const child = (id: string) => ({ id, parentID: parent, title: id, agent: "general", time: { created: 1, updated: 20 } }) as any

test("modern background is authoritative and preserves zero", () => {
  const result = backgroundFor({ parentID: parent, sessions: [child("child")], statuses: { [parent]: { type: "idle", background: { running: 0, jobs: [] } }, child: { type: "busy" } } })
  assert.deepEqual(result, { running: 0, jobs: [] })
})

test("background job navigation prefers the loaded child directory and falls back to the parent", () => {
  const job = { sessionID: "child", role: "QA", title: "Check", since: 1, status: "busy" as const }
  assert.deepEqual(backgroundJobRouteParams(job, [{ ...child("child"), directory: "/child" }], "/parent"), {
    id: "child",
    directory: "/child",
  })
  assert.deepEqual(backgroundJobRouteParams(job, [], "/parent"), { id: "child", directory: "/parent" })
})

test("legacy direct busy child uses parent task metadata", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", time: { start: 10 }, state: { status: "running", title: "task", input: { swarm_role: "QA" }, metadata: { sessionId: "child" } } } as any],
  })
  assert.deepEqual(result, { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Task QA: delegation", since: 10, status: "busy" }] })
})

test("completed parent task excludes stale busy child", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", state: { status: "completed", metadata: { sessionId: "child" } } } as any],
  })
  assert.equal(result, undefined)
})

test("only SSE received during a GET keeps its status over the snapshot", () => {
  assert.deepEqual(
    mergeStatusSnapshot({ fresh: { type: "busy" }, stale: { type: "busy" } }, { fresh: { type: "idle" }, stale: { type: "idle" } }, new Set(["fresh"]), 1),
    { fresh: { type: "busy" }, stale: { type: "idle" } },
  )
})

test("touched SSE inherits GET background only when it omits it", () => {
  const aggregate = { running: 2, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] }
  const snapshot = { parent: { type: "idle" as const, background: aggregate }, untouched: { type: "idle" as const } }
  assert.deepEqual(
    mergeStatusSnapshot({ parent: { type: "retry", attempt: 2, message: "again" }, untouched: { type: "busy" } }, snapshot, new Set(["parent"]), 1),
    { parent: { type: "retry", attempt: 2, message: "again", background: aggregate }, untouched: { type: "idle" } },
  )
  assert.deepEqual(
    mergeStatusSnapshot({ parent: { type: "idle", background: { running: 0, jobs: [] } } }, snapshot, new Set(["parent"]), 1).parent.background,
    { running: 0, jobs: [] },
  )
})

test("snapshot idle or absence settles stale busy IDs", () => {
  assert.deepEqual(
    mergeStatusSnapshot(
      { stale: { type: "busy" }, touched: { type: "busy" } },
      { server: { type: "idle" } },
      new Set(["touched"]),
      1,
    ),
    { stale: { type: "idle" }, touched: { type: "busy" }, server: { type: "idle" } },
  )
})

test("local resync idle revision prevents an older snapshot from resurrecting busy", () => {
  assert.deepEqual(
    mergeStatusSnapshot({ session: { type: "idle" } }, { session: { type: "busy" } }, new Set(["session"]), 1),
    { session: { type: "idle" } },
  )
})

test("a snapshot that omits background does not resurrect a finished worker", () => {
  // The daemon omits `background` entirely when nothing is running, so a GET
  // that leaves it out is a verdict. Inheriting the previous aggregate here is
  // what brought a settled worker back on every reopen/reconnect.
  const merged = mergeStatusSnapshot(
    { [parent]: { type: "idle", background: { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] } } },
    { [parent]: { type: "idle" } },
    new Set(),
    1,
  )
  assert.deepEqual(merged[parent], { type: "idle" })
  assert.equal(runningWorkerCount({ parentID: parent, sessions: [child("child")], statuses: merged }), 0)
})

test("omitted background preserves while explicit zero clears", () => {
  const prior = { type: "busy", background: { running: 1, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] } } as const
  assert.deepEqual(mergeStatusEvent(prior, { type: "idle" }), { type: "idle", background: prior.background })
  assert.deepEqual(mergeStatusEvent(prior, { type: "retry", attempt: 2, message: "again" }), { type: "retry", attempt: 2, message: "again", background: prior.background })
  assert.deepEqual(mergeStatusEvent(prior, { type: "idle", background: { running: 0, jobs: [] } }), { type: "idle", background: { running: 0, jobs: [] } })
})

test("modern jobs are sorted while legacy terminal children disappear", () => {
  const modern = backgroundFor({ parentID: parent, sessions: [child("a"), child("b")], statuses: { [parent]: { type: "busy", background: { running: 2, jobs: [{ sessionID: "b", role: "B", title: "B", since: 2 }, { sessionID: "a", role: "A", title: "A", since: 1 }] } } } })
  assert.deepEqual(modern?.jobs.map((job) => job.sessionID), ["a", "b"])
  assert.equal(backgroundFor({ parentID: parent, sessions: [child("a")], statuses: { a: { type: "busy" } }, terminalChildIDs: { a: true } }), undefined)
})

test("modern jobs remain visible despite stale terminal child IDs and completed task parts", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("done"), child("active")],
    statuses: {
      [parent]: {
        type: "busy",
        background: {
          running: 2,
          jobs: [
            { sessionID: "done", role: "QA", title: "Finished", since: 1 },
            { sessionID: "active", role: "Code", title: "Working", since: 2 },
          ],
        },
      },
    },
    parts: [{ type: "tool", tool: "task", state: { status: "completed", metadata: { sessionId: "done" } } } as any],
    terminalChildIDs: { done: true },
  })
  assert.deepEqual(result, {
    running: 2,
    jobs: [
      { sessionID: "done", role: "QA", title: "Finished", since: 1, status: "busy" },
      { sessionID: "active", role: "Code", title: "Working", since: 2, status: "busy" },
    ],
  })
})

test("recovered modern jobs retain server count and navigation fields without a current part", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("monitor")],
    statuses: { [parent]: { type: "busy", background: { running: 3, jobs: [{ sessionID: "monitor", role: "Monitor", title: "Recovered", since: 1 }] } } },
  })
  assert.deepEqual(result, { running: 3, jobs: [{ sessionID: "monitor", role: "Monitor", title: "Recovered", since: 1, status: "busy" }] })
  assert.deepEqual(backgroundJobRouteParams(result!.jobs[0], [child("monitor")], "/parent"), { id: "monitor", directory: "/parent" })
})

test("modern jobs retain all server jobs and exact server count", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [],
    statuses: { [parent]: { type: "busy", background: { running: 4, jobs: [
      { sessionID: "later", role: "Later", title: "Later", since: 2 },
      { sessionID: "first", role: "First", title: "First", since: 1 },
    ] } } },
  })
  assert.equal(result?.running, 4)
  assert.deepEqual(result?.jobs.map((job) => job.sessionID), ["first", "later"])
})

test("swarm role derives a useful task title", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [child("child")],
    statuses: { child: { type: "busy" } },
    parts: [{ type: "tool", tool: "task", state: { status: "running", input: { swarm_role: "QA", prompt: "Review background activity" }, metadata: { sessionId: "child" } } } as any],
  })
  assert.equal(result?.jobs[0].title, "Task QA: Review background activity")
})

test("malformed modern jobs render safe placeholders and sort deterministically", () => {
  const result = backgroundFor({
    parentID: parent,
    sessions: [],
    statuses: { [parent]: { type: "busy", background: { running: 3, jobs: [
      { role: "Goomba - Code (Implementer)", title: "Task Goomba - Code (Implementer): ...", owner: "local:65121:...:run_06fc..." },
      null,
      { role: null, title: null, owner: null, since: null },
    ] } } } as any,
  })
  assert.deepEqual(result, {
    running: 3,
    jobs: [
      { sessionID: "background-job-2", role: "Background worker", title: "Background task", since: 0, status: "busy" },
      { sessionID: "background-job-3", role: "Background worker", title: "Background task", since: 0, status: "busy" },
      { sessionID: "local:65121:...:run_06fc...", role: "Goomba - Code (Implementer)", title: "Task Goomba - Code (Implementer): ...", since: 0, status: "busy" },
    ],
  })
})

test("job comparison tolerates null fields without throwing", () => {
  assert.doesNotThrow(() => [{}, null, { title: null, owner: null }].sort(compareJobs))
})

// --- one worker count for the list and the detail screen (#34) ---

test("running is the count, not jobs.length: a settled session with stale jobs shows zero", () => {
  // The list read `background.jobs.length` and kept advertising workers on a
  // session the server had already reported as done.
  const stale = { running: 0, jobs: [{ sessionID: "child", role: "QA", title: "Check", since: 1 }] }
  const input = { parentID: parent, sessions: [child("child")], statuses: { [parent]: { type: "idle" as const, background: stale } } }
  assert.equal(backgroundFor(input)?.jobs.length, 1)
  assert.equal(runningWorkerCount(input), 0)
})

test("running counts the server's number even when it disagrees with jobs", () => {
  assert.equal(
    runningWorkerCount({
      parentID: parent,
      sessions: [],
      statuses: { [parent]: { type: "busy", background: { running: 2, jobs: [] } } },
    }),
    2,
  )
})

test("no background field falls back to busy children", () => {
  assert.equal(runningWorkerCount({ parentID: parent, sessions: [child("child")], statuses: { child: { type: "busy" } } }), 1)
})

test("no background field and no busy children is zero, not undefined", () => {
  assert.equal(runningWorkerCount({ parentID: parent, sessions: [child("child")], statuses: { child: { type: "idle" } } }), 0)
})

// --- `running` arrives as a boolean flag on some servers (#42) ---

test("boolean running from a live daemon payload counts the jobs it carries", () => {
  // Verbatim `session.status` properties from `GET /global/event` on daemon
  // 0.0.0-dogfood-stack2-c69fc06-20260906030515. `number(true)` was 0, so the
  // list never rendered "N workers running" and the detail chip never appeared.
  const status = {
    type: "busy",
    background: {
      running: true,
      jobs: [{
        id: "ses_f8a2a4333ffeMQZHA0BOthOTwd",
        sessionID: "ses_f8a2a4333ffeMQZHA0BOthOTwd",
        status: "running",
        role: "Goomba - QA (Validation)",
        title: "Task Goomba - QA (Validation): …",
        owner: "local:78530:…",
      }],
    },
  }
  const input = { parentID: parent, sessions: [], statuses: { [parent]: status } } as any
  assert.equal(runningWorkerCount(input), 1)
  assert.deepEqual(backgroundFor(input)?.jobs, [{
    sessionID: "ses_f8a2a4333ffeMQZHA0BOthOTwd",
    role: "Goomba - QA (Validation)",
    title: "Task Goomba - QA (Validation): …",
    since: 0,
    status: "busy",
  }])
})

test("running true counts every job the server sent", () => {
  assert.equal(
    runningWorkerCount({
      parentID: parent,
      sessions: [],
      statuses: { [parent]: { type: "busy", background: { running: true, jobs: [
        { sessionID: "a", role: "Code", title: "A", since: 1 },
        { sessionID: "b", role: "QA", title: "B", since: 2 },
        { sessionID: "c", role: "Review", title: "C", since: 3 },
      ] } } },
    } as any),
    3,
  )
})

test("running false clears stale job descriptors", () => {
  assert.equal(
    runningWorkerCount({
      parentID: parent,
      sessions: [],
      statuses: { [parent]: { type: "idle", background: { running: false, jobs: [
        { sessionID: "done", role: "QA", title: "Finished", since: 1 },
      ] } } },
    } as any),
    0,
  )
})

test("a numeric running is still authoritative, including an explicit zero", () => {
  const numeric = (running: number, jobs: unknown[]) => runningWorkerCount({
    parentID: parent,
    sessions: [],
    statuses: { [parent]: { type: "busy", background: { running, jobs } } },
  } as any)
  assert.equal(numeric(2, [
    { sessionID: "a", role: "Code", title: "A", since: 1 },
    { sessionID: "b", role: "QA", title: "B", since: 2 },
  ]), 2)
  assert.equal(numeric(0, [{ sessionID: "done", role: "QA", title: "Finished", since: 1 }]), 0)
})

test("a boolean-running job without id or sessionID still sorts without throwing", () => {
  assert.doesNotThrow(() => backgroundFor({
    parentID: parent,
    sessions: [],
    statuses: { [parent]: { type: "busy", background: { running: true, jobs: [
      { role: "Code", title: "No identity" },
      { sessionID: "b", role: "QA", title: "B", since: 2 },
    ] } } },
  } as any))
})

// --- a finished child must not keep the list chip at 1 (#44) ---

test("a completed child drops the list count with no parts and no session switch", () => {
  // Exactly what the list passes: statuses + sessions + the store's terminal
  // child IDs. No parts, no re-hydration, no navigation.
  const listInput = (statuses: Record<string, any>, terminalChildIDs: Record<string, true> = {}) => ({
    parentID: parent,
    sessions: [child("child")],
    statuses,
    terminalChildIDs,
  })
  assert.equal(runningWorkerCount(listInput({ child: { type: "busy" } })), 1)
  // The child's own status settles.
  assert.equal(runningWorkerCount(listInput({ child: { type: "idle" } })), 0)
})

test("a terminal parent task settles the list count even while the child's cached status is still busy", () => {
  // The reported bug: the parent's task part was `completed` and the child was
  // idle server-side, but the list read a stale cached `busy` and had no way to
  // exclude it, because it passed neither parts nor terminalChildIDs.
  assert.equal(
    runningWorkerCount({ parentID: parent, sessions: [child("child")], statuses: { child: { type: "busy" } }, terminalChildIDs: { child: true } }),
    0,
  )
})

test("an omitted parent aggregate is an authoritative zero on a daemon that speaks background", () => {
  // The parent has a status entry with no `background`, and some other session
  // on this same connection carries one — so the daemon demonstrably sends the
  // key and its absence here means nothing is running. The legacy heuristic
  // must not fire and re-count the stale busy child.
  const statuses = {
    [parent]: { type: "idle" as const },
    other: { type: "busy" as const, background: { running: 1, jobs: [{ sessionID: "elsewhere", role: "QA", title: "Check", since: 1 }] } },
    child: { type: "busy" as const },
  }
  assert.equal(speaksBackground(statuses), true)
  assert.equal(runningWorkerCount({ parentID: parent, sessions: [child("child")], statuses }), 0)
})

test("a daemon that has never sent background still counts busy children", () => {
  // The fallback must not become dead code: no `background` key anywhere on the
  // connection is an old daemon, and the busy-child heuristic is all we have.
  const statuses = { [parent]: { type: "busy" as const }, child: { type: "busy" as const } }
  assert.equal(speaksBackground(statuses), false)
  assert.equal(runningWorkerCount({ parentID: parent, sessions: [child("child")], statuses }), 1)
})
