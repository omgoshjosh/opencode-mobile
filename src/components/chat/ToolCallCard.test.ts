import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import test from "node:test"

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ToolCallCard.tsx"), "utf8")

// React Native rendering is not configured for node:test. This source harness
// guards the terminal fallback's visible and interactive contract instead.
test("completed missing reports show an accessible warning and diagnostic action", () => {
  assert.match(source, /isCompletedSubagentReportMissing/)
  assert.match(source, /accessibilityRole="alert" accessibilityLiveRegion="polite"/)
  assert.match(source, />Completed without a report</)
  assert.match(source, /missingReport \? "Open diagnostics"/)
  assert.match(source, /<SubagentBanner link=\{taskLink\} directory=\{directory\} isDark=\{isDark\} missingReport=\{taskMissingReport\}/)
  assert.match(source, /\|\| error \|\| taskMissingReport/)
})

test("only running calls render terminal activity", () => {
  assert.match(source, /\{status === "running" && <ActivityIndicator/)
})
