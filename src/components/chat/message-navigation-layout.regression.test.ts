import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// Follow the existing source-level RN regression pattern: node:test cannot
// render native layouts. This guard fails on the original overlapping layout;
// changed-head device/keyboard acceptance is still required.
const source = readFileSync(new URL("../../../app/session/[id].tsx", import.meta.url), "utf8")

test("message content reserves a gutter for the floating navigation controls", () => {
  assert.match(source, /contentContainerStyle=\{s\.messageList\}/)
  assert.match(source, /<View style=\{s\.scrollControls\}>/)
  const content = source.match(/messageList:\s*\{([^}]+)\}/)?.[1] ?? ""
  const controls = source.match(/scrollControls:\s*\{([^}]+)\}/)?.[1] ?? ""
  const button = source.match(/scrollBtn:\s*\{([^}]+)\}/)?.[1] ?? ""
  const padding = Number(content.match(/paddingRight:\s*(\d+)/)?.[1])
  const inset = Number(controls.match(/right:\s*(\d+)/)?.[1])
  const width = Number(button.match(/width:\s*(\d+)/)?.[1])
  const height = Number(button.match(/height:\s*(\d+)/)?.[1])

  assert.ok(width >= 44 && height >= 44, "keep practical navigation hit targets")
  assert.ok(padding >= inset + width + 16, "all message lines must clear the control rail and text gap")
})
