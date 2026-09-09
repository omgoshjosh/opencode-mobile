import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const workflow = new URL("../.github/workflows/build.yml", import.meta.url)
const expression = "${{ github.repository == 'dzianisv/opencode-mobile' && github.event_name == 'push' && 'false' || 'true' }}"

test("Sentry source-map upload is limited to canonical push builds", async () => {
  const build = await readFile(workflow, "utf8")

  assert.match(build, new RegExp(`SENTRY_DISABLE_AUTO_UPLOAD: ${expression.replace(/[${}]/g, "\\$&")}`))

  for (const [repository, event, ref, disabled] of [
    ["dzianisv/opencode-mobile", "push", "refs/heads/main", false],
    ["dzianisv/opencode-mobile", "push", "refs/tags/v0.4.15", false],
    ["dzianisv/opencode-mobile", "pull_request", "refs/pull/51/merge", true],
    ["omgoshjosh/opencode-mobile", "push", "refs/heads/main", true],
    ["omgoshjosh/opencode-mobile", "push", "refs/tags/v0.4.15", true],
    ["omgoshjosh/opencode-mobile", "pull_request", "refs/pull/51/merge", true],
  ]) {
    assert.ok(ref)
    assert.equal(repository !== "dzianisv/opencode-mobile" || event !== "push", disabled)
  }
})
