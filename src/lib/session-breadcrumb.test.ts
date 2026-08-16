import { test } from "node:test"
import assert from "node:assert/strict"
import { breadcrumbFor } from "./session-breadcrumb.ts"

const sessions = [
  { id: "ses_parent", title: "Opencodex reliability team" },
  { id: "ses_other", title: "Something else" },
]

test("a root session has no breadcrumb", () => {
  assert.equal(breadcrumbFor({ parentID: undefined }, sessions), null)
  assert.equal(breadcrumbFor({}, sessions), null)
  assert.equal(breadcrumbFor(null, sessions), null)
})

test("a child resolves its parent's title", () => {
  const crumb = breadcrumbFor({ parentID: "ses_parent" }, sessions)
  assert.equal(crumb?.label, "Opencodex reliability team")
  assert.equal(crumb?.resolved, true)
  assert.equal(crumb?.parentID, "ses_parent")
})

// The list is capped and a child can be deep-linked, so a miss is routine.
// Navigation still works, so the affordance must not disappear.
test("an unloaded parent still yields a usable breadcrumb", () => {
  const crumb = breadcrumbFor({ parentID: "ses_missing" }, sessions)
  assert.equal(crumb?.parentID, "ses_missing")
  assert.equal(crumb?.resolved, false)
  assert.ok(crumb!.label.length > 0)
})

test("an empty session list degrades rather than throwing", () => {
  assert.equal(breadcrumbFor({ parentID: "ses_parent" }, [])?.resolved, false)
  assert.equal(breadcrumbFor({ parentID: "ses_parent" }, null)?.resolved, false)
})

test("a whitespace-only parentID is not a parent", () => {
  assert.equal(breadcrumbFor({ parentID: "   " }, sessions), null)
})

test("a parent with a blank title falls back rather than showing nothing", () => {
  const crumb = breadcrumbFor({ parentID: "p" }, [{ id: "p", title: "  " }])
  assert.equal(crumb?.resolved, false)
  assert.ok(crumb!.label.length > 0)
})
