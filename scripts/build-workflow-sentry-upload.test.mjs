import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const workflow = new URL("../.github/workflows/build.yml", import.meta.url)
const expression = "${{ github.repository == 'dzianisv/opencode-mobile' && github.event_name == 'push' && 'false' || 'true' }}"

function evaluate(expression, repository, event) {
  const source = expression.slice(3, -3)

  return Function("github", `return (${source})`)({
    repository,
    event_name: event,
  })
}

test("Sentry source-map upload is limited to canonical push builds", async () => {
  const build = await readFile(workflow, "utf8")
  const line = build.split("\n").find((line) => line.startsWith("      SENTRY_DISABLE_AUTO_UPLOAD:"))

  assert.equal(line, `      SENTRY_DISABLE_AUTO_UPLOAD: ${expression}`)
  const guard = line.slice("      SENTRY_DISABLE_AUTO_UPLOAD: ".length)

  for (const [repository, event, disabled] of [
    ["dzianisv/opencode-mobile", "push", false],
    ["dzianisv/opencode-mobile", "pull_request", true],
    ["dzianisv/opencode-mobile", "workflow_dispatch", true],
    ["omgoshjosh/opencode-mobile", "push", true],
    ["omgoshjosh/opencode-mobile", "pull_request", true],
    ["omgoshjosh/opencode-mobile", "workflow_dispatch", true],
  ]) {
    assert.equal(evaluate(guard, repository, event), String(disabled))
  }
})
