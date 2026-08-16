import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MIN_ROLES,
  addRole,
  canSaveRoles,
  humanizeSkillName,
  isRoleConfigured,
  isSwarmReady,
  moveRole,
  removeRole,
  roleFromSkill,
  swarmBlocker,
  toRoleInput,
  unusedSkills,
  updateRole,
  type RoleInput,
} from "./swarm-crud.ts"

function role(name: string, extra: Partial<RoleInput> = {}): RoleInput {
  return { name, instructions: "do the thing", providerID: "openai", modelID: "gpt-5.6-sol", ...extra }
}

// --- readiness ---

test("a configured role has both a provider and a model", () => {
  assert.equal(isRoleConfigured(role("a")), true)
  assert.equal(isRoleConfigured({ name: "a", instructions: "x", providerID: "openai" }), false)
  assert.equal(isRoleConfigured({ name: "a", instructions: "x" }), false)
})

test("a swarm needs at least two roles to be a team", () => {
  assert.equal(isSwarmReady([role("a")]), false)
  assert.equal(isSwarmReady([role("a"), role("b")]), true)
  assert.equal(MIN_ROLES, 2)
})

test("one unconfigured role blocks the whole swarm", () => {
  assert.equal(isSwarmReady([role("a"), { name: "b", instructions: "x" }]), false)
})

// --- blockers ---

test("blockers name the specific problem", () => {
  assert.match(swarmBlocker("", [role("a"), role("b")])!, /name/i)
  assert.match(swarmBlocker("T", [role("a")])!, /at least/i)
  assert.match(swarmBlocker("T", [role("a"), role("", {})])!, /role needs a name/i)
  assert.match(swarmBlocker("T", [role("a"), role("b", { instructions: "" })])!, /instructions/i)
})

test("the model blocker names the offending role", () => {
  const blocker = swarmBlocker("T", [role("a"), { name: "Reviewer", instructions: "x" }])
  assert.match(blocker!, /Reviewer/)
})

test("a complete swarm has no blocker", () => {
  assert.equal(swarmBlocker("Team", [role("a"), role("b")]), null)
})

test("a whitespace-only title is still missing", () => {
  assert.match(swarmBlocker("   ", [role("a"), role("b")])!, /name/i)
})

// --- role input normalisation ---

test("server-assigned fields are stripped before saving", () => {
  const out = toRoleInput({
    id: "rol_1",
    swarmID: "swm_1",
    status: "planned",
    sortOrder: 3,
    sessionID: "ses_1",
    jobID: "job_1",
    name: "Reviewer",
    instructions: "review",
    providerID: "openai",
    modelID: "gpt-5.6-sol",
  })
  assert.deepEqual(Object.keys(out).sort(), ["instructions", "modelID", "name", "providerID"])
})

test("blank optional fields are omitted rather than sent empty", () => {
  const out = toRoleInput({ name: "a", instructions: "x", agent: "  ", skill: "", variant: "  " })
  assert.equal("agent" in out, false)
  assert.equal("skill" in out, false)
  assert.equal("variant" in out, false)
})

test("names and instructions are trimmed", () => {
  const out = toRoleInput({ name: "  a  ", instructions: "  x  " })
  assert.equal(out.name, "a")
  assert.equal(out.instructions, "x")
})

test("missing name and instructions degrade to empty strings, not undefined", () => {
  const out = toRoleInput({})
  assert.equal(out.name, "")
  assert.equal(out.instructions, "")
})

// --- the destructive-save guard ---

// PATCH replaces the role set, so an empty array deletes every role. This
// turns "I renamed the swarm" into "I wiped its team".
test("an empty role array must never be saved", () => {
  assert.equal(canSaveRoles([]), false)
  assert.equal(canSaveRoles(null), false)
  assert.equal(canSaveRoles(undefined), false)
})

test("a populated role array can be saved", () => {
  assert.equal(canSaveRoles([role("a")]), true)
})

// --- list edits ---

test("adding appends", () => {
  const out = addRole([role("a")], role("b"))
  assert.deepEqual(out.map((r) => r.name), ["a", "b"])
})

test("updating patches one role and leaves the rest alone", () => {
  const out = updateRole([role("a"), role("b")], 1, { name: "renamed" })
  assert.deepEqual(out.map((r) => r.name), ["a", "renamed"])
})

test("updating out of range is a no-op", () => {
  const roles = [role("a")]
  assert.equal(updateRole(roles, 5, { name: "x" }), roles)
  assert.equal(updateRole(roles, -1, { name: "x" }), roles)
})

test("removing drops exactly one role", () => {
  const out = removeRole([role("a"), role("b"), role("c")], 1)
  assert.deepEqual(out.map((r) => r.name), ["a", "c"])
})

test("removing out of range is a no-op", () => {
  const roles = [role("a")]
  assert.equal(removeRole(roles, 9), roles)
})

test("edits do not mutate their input", () => {
  const roles = [role("a")]
  addRole(roles, role("b"))
  removeRole(roles, 0)
  updateRole(roles, 0, { name: "z" })
  assert.deepEqual(roles.map((r) => r.name), ["a"])
})

// --- reorder ---

test("moving reorders", () => {
  const out = moveRole([role("a"), role("b"), role("c")], 0, 2)
  assert.deepEqual(out.map((r) => r.name), ["b", "c", "a"])
})

test("moving backwards works too", () => {
  const out = moveRole([role("a"), role("b"), role("c")], 2, 0)
  assert.deepEqual(out.map((r) => r.name), ["c", "a", "b"])
})

test("a no-op or out-of-range move changes nothing", () => {
  const roles = [role("a"), role("b")]
  assert.deepEqual(moveRole(roles, 1, 1).map((r) => r.name), ["a", "b"])
  assert.deepEqual(moveRole(roles, -1, 1).map((r) => r.name), ["a", "b"])
  assert.deepEqual(moveRole(roles, 0, 9).map((r) => r.name), ["a", "b"])
})

// --- skills ---

test("a skill seeds a usable role, not an empty form", () => {
  const out = roleFromSkill({ name: "release-engineer", description: "Plan releases and rollbacks." })
  assert.equal(out.skill, "release-engineer")
  assert.equal(out.name, "Release Engineer")
  assert.equal(out.instructions, "Plan releases and rollbacks.")
})

test("a skill with no description still yields workable instructions", () => {
  const out = roleFromSkill({ name: "qa" })
  assert.ok(out.instructions.includes("qa"))
})

test("skill names humanize across separators", () => {
  assert.equal(humanizeSkillName("release-engineer"), "Release Engineer")
  assert.equal(humanizeSkillName("code_review"), "Code Review")
  assert.equal(humanizeSkillName("basecamp:basecamp"), "Basecamp Basecamp")
  assert.equal(humanizeSkillName("qa"), "Qa")
})

test("already-used skills are not offered again", () => {
  const skills = [{ name: "qa" }, { name: "docs" }]
  const out = unusedSkills(skills, [role("QA", { skill: "qa" })])
  assert.deepEqual(out.map((s) => s.name), ["docs"])
})

test("roles without a skill do not filter anything out", () => {
  const skills = [{ name: "qa" }]
  assert.deepEqual(unusedSkills(skills, [role("Anything")]).map((s) => s.name), ["qa"])
})

test("empty inputs are tolerated", () => {
  assert.deepEqual(unusedSkills([], []), [])
  assert.deepEqual(unusedSkills(null as never, null as never), [])
})
