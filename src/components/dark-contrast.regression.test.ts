import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// Tripwire for the dark-mode contrast audit.
//
// The audit found a systemic habit: every file that wrote a dim-text style for
// dark mode independently chose #666666 (or #777777) — roughly 3:1 against the
// app's near-black surfaces, below the 4.5:1 floor for small text. The user's
// report was concrete: the model picker and message labels were "hard to see".
//
// Policy: dim text in dark mode floors at #9a9a9a (5.5–7:1 on every surface
// the app uses, still visually secondary next to #fff). This test greps the
// component and screen sources so the eleventh file to invent its own dim
// grey gets caught in CI, not on a phone.

const ROOTS = ["src/components", "app"]

// Text colors banned inside a dark-mode style or `isDark ?` ternary.
// #555 stays allowed: it is used only for de-emphasising *disabled/ignored*
// items, which are dim on purpose.
const BANNED = /(?:Dark[A-Za-z]*: \{[^}]*color: "#(?:666666|777777)")|(?:isDark \? "#(?:666666|777777)")/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") ? [full] : []
  })
}

test("no dark-mode text color falls below the audited contrast floor", () => {
  const offenders: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8")
      if (BANNED.test(source)) offenders.push(file)
    }
  }
  assert.deepEqual(offenders, [], `dark-mode #666/#777 text found in: ${offenders.join(", ")}`)
})
