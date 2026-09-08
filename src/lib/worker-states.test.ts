import { test } from "node:test"
import assert from "node:assert/strict"
import {
  activeWorkerCount,
  countWorkerStates,
  deriveWorkerStates,
  summarizeWorkerStates,
  trackEndedJobs,
  workerStateColors,
  workerStateLabel,
  workerStateSections,
  workerStatesFor,
  workerStatesLabel,
  WORKER_STATE_PRIORITY,
  type WorkerState,
} from "./worker-states.ts"

const job = (sessionID: string) => ({ sessionID, role: "engineer", title: "Do the thing" })
const question = (sessionID: string, id = `q-${sessionID}`) => ({ id, sessionID })

test("priority order is awaiting-answer > failed > stalled > working > queued > ended", () => {
  assert.deepEqual([...WORKER_STATE_PRIORITY], ["awaiting-answer", "failed", "stalled", "working", "queued", "ended"])
})

test("every pairwise combination picks the higher-priority state as top", () => {
  for (let i = 0; i < WORKER_STATE_PRIORITY.length; i++) {
    for (let j = i + 1; j < WORKER_STATE_PRIORITY.length; j++) {
      const higher = WORKER_STATE_PRIORITY[i]!
      const lower = WORKER_STATE_PRIORITY[j]!
      assert.equal(summarizeWorkerStates({ [higher]: 1, [lower]: 1 }).top, higher, `${higher} must outrank ${lower}`)
      // Order of the counts object must not matter.
      assert.equal(summarizeWorkerStates({ [lower]: 1, [higher]: 1 }).top, higher, `${higher} must outrank ${lower} regardless of key order`)
    }
  }
})

test("a mixed summary leads with the demanding state and adds what is still moving", () => {
  assert.equal(workerStatesLabel({ "awaiting-answer": 1, working: 2 }), "1 needs input · 2 working")
  assert.equal(workerStatesLabel({ failed: 1, queued: 3 }), "1 failed · 3 queued")
  assert.equal(workerStatesLabel({ stalled: 2, working: 1 }), "2 stalled · 1 working")
})

test("the second segment is only ever working or queued, and never repeats the top", () => {
  // Top is already `working`: nothing to add.
  assert.deepEqual(summarizeWorkerStates({ working: 3, queued: 2 }).segments.map((s) => s.label), ["3 working"])
  // Top is `queued`: `working` is zero, so there is no second segment to add.
  assert.deepEqual(summarizeWorkerStates({ queued: 1, ended: 4 }).segments.map((s) => s.label), ["1 queued"])
  // `ended` is never promoted into the second slot.
  assert.deepEqual(summarizeWorkerStates({ "awaiting-answer": 1, ended: 4 }).segments.map((s) => s.label), ["1 needs input"])
  // Never more than two, even with every state present.
  const all = summarizeWorkerStates({ "awaiting-answer": 1, failed: 1, stalled: 1, working: 1, queued: 1, ended: 1 })
  assert.equal(all.segments.length, 2)
  assert.deepEqual(all.segments.map((s) => s.label), ["1 needs input", "1 working"])
})

test("copy pluralises per state", () => {
  assert.equal(workerStateLabel("awaiting-answer", 1), "1 needs input")
  assert.equal(workerStateLabel("awaiting-answer", 2), "2 need input")
  assert.equal(workerStateLabel("working", 3), "3 working")
  assert.equal(workerStateLabel("queued", 1), "1 queued")
  assert.equal(workerStateLabel("stalled", 2), "2 stalled")
  assert.equal(workerStateLabel("failed", 1), "1 failed")
  assert.equal(workerStateLabel("ended", 3), "3 ended")
})

test("an empty or zeroed count summarises to nothing", () => {
  assert.deepEqual(summarizeWorkerStates({}).segments, [])
  assert.deepEqual(summarizeWorkerStates({ working: 0 }).segments, [])
  assert.equal(workerStatesLabel({}), "")
})

test("ended never contributes to the active count", () => {
  assert.equal(activeWorkerCount({ ended: 4 }), 0)
  assert.equal(activeWorkerCount({ working: 2, ended: 4 }), 2)
  assert.equal(activeWorkerCount({ "awaiting-answer": 1, working: 2, queued: 1, ended: 9 }), 4)
  // ...but it can still be the top state, so the sheet can label its section.
  assert.equal(summarizeWorkerStates({ ended: 3 }).top, "ended")
  assert.equal(workerStatesLabel({ ended: 3 }), "3 ended")
})

test("a job whose session has a pending question is awaiting-answer, the rest are working", () => {
  const derived = deriveWorkerStates({
    jobs: [job("child-a"), job("child-b")],
    questionsBySession: { "child-a": [question("child-a")] },
  })
  assert.deepEqual(derived.map((d) => [d.sessionID, d.state]), [["child-a", "awaiting-answer"], ["child-b", "working"]])
  assert.deepEqual(countWorkerStates(derived), { "awaiting-answer": 1, working: 1 })
})

test("once the question is answered the job goes back to working", () => {
  const jobs = [job("child-a")]
  // `question.replied` removes the entry for that sessionID (events store),
  // which is the only thing that produced `awaiting-answer`.
  const before = deriveWorkerStates({ jobs, questionsBySession: { "child-a": [question("child-a")] } })
  assert.equal(before[0]!.state, "awaiting-answer")
  const after = deriveWorkerStates({ jobs, questionsBySession: { "child-a": [] } })
  assert.equal(after[0]!.state, "working")
  assert.equal(activeWorkerCount(countWorkerStates(after)), 1)
})

test("a question for an unrelated session does not touch a job", () => {
  const derived = deriveWorkerStates({ jobs: [job("child-a")], questionsBySession: { "someone-else": [question("someone-else")] } })
  assert.equal(derived[0]!.state, "working")
})

// --- `running` stays the count, states come from the descriptors (#34) ---

test("a settled session with stale job descriptors shows no workers", () => {
  const { jobs, counts } = workerStatesFor({ running: 0, jobs: [job("child-a")], questionsBySession: { "child-a": [question("child-a")] } })
  assert.deepEqual(jobs, [])
  assert.deepEqual(counts, {})
  assert.equal(activeWorkerCount(counts), 0)
})

test("workers the server counts but does not describe are working", () => {
  const { counts } = workerStatesFor({ running: 2, jobs: [], questionsBySession: {} })
  assert.deepEqual(counts, { working: 2 })
  assert.equal(workerStatesLabel(counts), "2 working")
})

test("extra descriptors are dropped highest-priority first, so a blocked worker survives the clamp", () => {
  const { jobs, counts } = workerStatesFor({
    running: 1,
    jobs: [job("child-a"), job("child-b"), job("child-c")],
    questionsBySession: { "child-c": [question("child-c")] },
  })
  assert.deepEqual(jobs.map((j) => [j.sessionID, j.state]), [["child-c", "awaiting-answer"]])
  assert.equal(activeWorkerCount(counts), 1)
})

test("a described blocked worker and an undescribed one summarise together", () => {
  const { counts } = workerStatesFor({ running: 3, jobs: [job("child-a")], questionsBySession: { "child-a": [question("child-a")] } })
  assert.deepEqual(counts, { "awaiting-answer": 1, working: 2 })
  assert.equal(workerStatesLabel(counts), "1 needs input · 2 working")
})

test("sections come out in priority order with empty states omitted", () => {
  const jobs = [
    { sessionID: "a", state: "working" as WorkerState },
    { sessionID: "b", state: "awaiting-answer" as WorkerState },
    { sessionID: "c", state: "working" as WorkerState },
  ]
  assert.deepEqual(
    workerStateSections(jobs).map((section) => [section.state, section.jobs.length]),
    [["awaiting-answer", 1], ["working", 2]],
  )
})

test("a job vanishing from jobs[] leaves the active count and appears once under 'No longer running'", () => {
  const active = [job("child-a"), job("child-b")]
  let ended: readonly ReturnType<typeof job>[] = []

  ended = trackEndedJobs(active, [job("child-a")], ended)
  assert.deepEqual(ended.map((e) => e.sessionID), ["child-b"])
  assert.equal(activeWorkerCount(countWorkerStates(deriveWorkerStates({ jobs: [job("child-a")], questionsBySession: {} }))), 1)

  // A later poll with the same active set must not duplicate the row.
  ended = trackEndedJobs([job("child-a")], [job("child-a")], ended)
  assert.deepEqual(ended.map((e) => e.sessionID), ["child-b"])
})

test("nothing leaving returns the same array, so holding it in state does not loop", () => {
  const ended = [job("child-b")]
  assert.equal(trackEndedJobs([job("child-a")], [job("child-a")], ended), ended)
})

test("a job that comes back drops out of 'No longer running'", () => {
  const ended = trackEndedJobs([job("child-b")], [job("child-b")], [job("child-b")])
  assert.deepEqual(ended.map((e) => e.sessionID), [])
})

test("only the last five departures are kept, most recent first", () => {
  const all = ["a", "b", "c", "d", "e", "f"].map(job)
  let ended: readonly ReturnType<typeof job>[] = []
  for (let i = 0; i < all.length; i++) ended = trackEndedJobs([all[i]!], [], ended)
  assert.deepEqual(ended.map((e) => e.sessionID), ["f", "e", "d", "c", "b"])
})

// Relative luminance / contrast per WCAG 2.1, so the chip's foreground is
// asserted rather than eyeballed.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

test("every chip fill clears 4.5:1 against its foreground", () => {
  for (const state of WORKER_STATE_PRIORITY) {
    const { background, foreground } = workerStateColors(state)
    assert.ok(contrast(background, foreground) >= 4.5, `${state}: ${background} on ${foreground} is ${contrast(background, foreground).toFixed(2)}:1`)
  }
})

test("chip fills reuse the triage dot palette", () => {
  assert.equal(workerStateColors("awaiting-answer").background, "#dc2626")
  assert.equal(workerStateColors("working").background, "#16a34a")
  assert.equal(workerStateColors("ended").background, "#60a5fa")
  assert.equal(workerStateColors("stalled").background, "#b45309")
  assert.equal(workerStateColors("failed").background, "#b45309")
  assert.equal(workerStateColors("queued").background, "#9a9a9a")
})
