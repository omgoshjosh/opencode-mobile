import { test } from "node:test"
import assert from "node:assert/strict"
import {
  recordSample,
  isRestSlow,
  SLOW_REQUEST_MS,
  VERY_SLOW_REQUEST_MS,
  LATENCY_WINDOW_MS,
  MAX_SAMPLES,
  type LatencySample,
} from "./rest-latency.ts"

const T = 1_000_000

function samplesOf(...ms: number[]): LatencySample[] {
  return ms.reduce<LatencySample[]>((acc, m, i) => recordSample(acc, m, T + i * 1000), [])
}

test("no samples, no verdict", () => {
  assert.equal(isRestSlow([], T), false)
})

test("one mildly slow request is noise, not a verdict", () => {
  assert.equal(isRestSlow(samplesOf(SLOW_REQUEST_MS + 500), T + 5000), false)
})

test("a pattern of slow requests flags", () => {
  assert.equal(isRestSlow(samplesOf(4000, 5000), T + 5000), true)
})

test("median, not mean: one slow outlier among fast requests stays quiet", () => {
  assert.equal(isRestSlow(samplesOf(200, 300, 4000), T + 5000), false)
})

test("a single very slow request (e.g. a timeout) flags immediately", () => {
  assert.equal(isRestSlow(samplesOf(VERY_SLOW_REQUEST_MS), T + 1000), true)
})

test("fast samples pull the verdict back to healthy", () => {
  const slowThenFast = samplesOf(4000, 5000, 150, 180, 120)
  assert.equal(isRestSlow(slowThenFast, T + 6000), false)
})

test("evidence ages out of the window entirely", () => {
  const slow = samplesOf(9000, 9000)
  assert.equal(isRestSlow(slow, T + LATENCY_WINDOW_MS + 2000), false)
})

test("ring buffer stays bounded and drops the oldest", () => {
  let samples: LatencySample[] = []
  for (let i = 0; i < MAX_SAMPLES + 10; i++) samples = recordSample(samples, 100, T + i)
  assert.equal(samples.length, MAX_SAMPLES)
  assert.equal(samples[0].at, T + 10)
})

test("recordSample prunes out-of-window entries on write", () => {
  let samples = recordSample([], 100, T)
  samples = recordSample(samples, 100, T + LATENCY_WINDOW_MS + 1)
  assert.equal(samples.length, 1)
})
