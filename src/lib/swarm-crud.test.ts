import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MIN_ROLES,
  addRole,
  applyPerRoleFallback,
  canSaveRoles,
  humanizeSkillName,
  isRoleConfigured,
  isSwarmReady,
  moveRole,
  reconcileRoles,
  removeRole,
  roleFromSkill,
  swarmBlocker,
  toRoleInput,
  unusedSkills,
  updateRole,
  type RoleInput,
  type ServerRole,
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

// --- per-role server contract ---

function serverRole(id: string, name: string): ServerRole {
  return { id, name }
}

test("reconciliation adds roles the server does not have", () => {
  const rec = reconcileRoles([serverRole("r1", "Orchestrator")], [role("Scout"), role("Checker")])
  assert.deepEqual(rec.updates, [])
  assert.deepEqual(rec.adds.map((r) => r.name), ["Scout", "Checker"])
  assert.deepEqual(rec.undeletable.map((r) => r.name), ["Orchestrator"])
})

test("reconciliation matches by trimmed name and keeps the server id", () => {
  const rec = reconcileRoles(
    [serverRole("r1", " Scout ")],
    [{ ...role("Scout"), modelID: "haiku" }],
  )
  assert.deepEqual(rec.adds, [])
  assert.equal(rec.updates.length, 1)
  assert.equal(rec.updates[0].roleID, "r1")
  assert.deepEqual(rec.undeletable, [])
})

test("duplicate desired names pair up with distinct server rows", () => {
  const rec = reconcileRoles(
    [serverRole("r1", "Scout"), serverRole("r2", "Scout")],
    [role("Scout"), role("Scout")],
  )
  assert.deepEqual(rec.updates.map((u) => u.roleID), ["r1", "r2"])
  assert.deepEqual(rec.undeletable, [])
})

test("roles removed from the desired set come back undeletable, not silently dropped", () => {
  const rec = reconcileRoles([serverRole("r1", "Old Hat")], [role("New Role")])
  assert.deepEqual(rec.adds.map((r) => r.name), ["New Role"])
  assert.deepEqual(rec.undeletable.map((r) => r.name), ["Old Hat"])
})

function fakeTransport(server: { title: string; roles: ServerRole[] }): SwarmWriteTransport & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    get: async () => ({ id: "swm_1", title: server.title, roles: server.roles }),
    patchTitle: async (_id, title) => {
      calls.push(`title:${title}`)
      server.title = title
    },
    addRole: async (_id, r) => {
      calls.push(`add:${r.name}`)
      server.roles.push({ id: `new-${server.roles.length}`, name: r.name })
    },
    updateRole: async (_id, roleID, _r) => {
      calls.push(`update:${roleID}`)
    },
  }
}

const DESIRED = [role("Orchestrator"), role("Scout"), role("Extra")]

test("fallback renames first, then updates, then adds", async () => {
  const server = { title: "Old", roles: [serverRole("r1", "Orchestrator")] }
  const t = fakeTransport(server)
  const out = await applyPerRoleFallback(t, "swm_1", { title: "New", roles: DESIRED })
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.deepEqual(t.calls, ["title:New", "update:r1", "add:Scout", "add:Extra"])
  assert.equal(out.updated, 1)
  assert.equal(out.added, 2)
  assert.equal(out.renamed, true)
  assert.deepEqual(out.undeletable, [])
})

test("fallback skips a no-op rename", async () => {
  const t = fakeTransport({ title: "Same", roles: [] })
  const out = await applyPerRoleFallback(t, "swm_1", { title: "Same", roles: DESIRED })
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.equal(out.renamed, false)
  assert.ok(t.calls.every((c) => !c.startsWith("title:")))
})

test("a load failure reports the phase instead of writing blind", async () => {
  const t = fakeTransport({ title: "T", roles: [] })
  t.get = async () => {
    throw new Error("401")
  }
  const out = await applyPerRoleFallback(t, "swm_1", { title: "N", roles: DESIRED })
  assert.deepEqual(out, { ok: false, phase: "load", detail: "Error: 401" })
  assert.deepEqual(t.calls, [])
})

test("a rename failure stops before any role write", async () => {
  const t = fakeTransport({ title: "Old", roles: [] })
  t.patchTitle = async () => {
    throw new Error("400")
  }
  const out = await applyPerRoleFallback(t, "swm_1", { title: "New", roles: DESIRED })
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.phase, "rename")
  assert.deepEqual(t.calls, [])
})

test("a mid-write failure reports what landed before it stopped", async () => {
  const server = { title: "T", roles: [serverRole("r1", "Orchestrator"), serverRole("r2", "Scout")] }
  const t = fakeTransport(server)
  let updates = 0
  t.updateRole = async (_id, roleID) => {
    updates += 1
    if (updates === 2) throw new Error("500")
  }
  const out = await applyPerRoleFallback(t, "swm_1", { title: "T", roles: DESIRED })
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.phase, "write")
  assert.match(out.detail, /after 1 updated, 0 added/)
})
