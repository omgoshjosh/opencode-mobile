// Editing swarms and their roles.
//
// The server models a swarm's roles as a SET, not as individually addressable
// rows: `PATCH /experimental/opencodex/swarm/:id` takes a full `roles` array
// and replaces what is there. There is no per-role DELETE, and none is needed —
// removing a role means saving the array without it. The GUI works exactly this
// way (`updateSwarm(client, id, { title, roles })`).
//
// That shape has one sharp edge worth naming: a save is destructive to anything
// not included. Sending a partially-loaded or empty array silently deletes
// every role omitted from it. So the guard here is not validation politeness —
// it is the difference between "renamed a swarm" and "wiped its team".
//
// Pure, so the edit rules are testable without a client or a store.

/** What the server accepts per role. Mirrors OpencodeXSwarmRoleInput. */
export interface RoleInput {
  name: string
  agent?: string
  skill?: string
  providerID?: string
  modelID?: string
  variant?: string
  modelProfile?: string
  instructions: string
}

/** A role as it comes back, with server-assigned fields. */
export interface Role extends RoleInput {
  id: string
  swarmID: string
  status: string
  sortOrder: number
  sessionID?: string
  jobID?: string
}

export interface Swarm {
  id: string
  title: string
  prompt: string
  status: string
  projectID?: string
  roles: Role[]
  timeCreated: number
  timeUpdated: number
}

/**
 * A swarm needs at least two roles to be a team rather than a single agent
 * wearing a hat, and every role needs a model or it cannot run. Mirrors the
 * GUI's readiness rule so the two clients agree on what "ready" means.
 */
export const MIN_ROLES = 2

export function isRoleConfigured(role: RoleInput): boolean {
  return Boolean(role.providerID && role.modelID)
}

export function isSwarmReady(roles: RoleInput[]): boolean {
  const list = roles ?? []
  return list.length >= MIN_ROLES && list.every(isRoleConfigured)
}

/** Why a swarm can't be saved yet, or null when it can. */
export function swarmBlocker(title: string, roles: RoleInput[]): string | null {
  if (!title.trim()) return "Give the swarm a name."
  const list = roles ?? []
  if (list.length < MIN_ROLES) return `A swarm needs at least ${MIN_ROLES} roles.`
  if (list.some((role) => !role.name.trim())) return "Every role needs a name."
  if (list.some((role) => !role.instructions.trim())) return "Every role needs instructions."
  const unconfigured = list.filter((role) => !isRoleConfigured(role))
  if (unconfigured.length > 0) return `Pick a model for ${unconfigured[0].name.trim() || "every role"}.`
  return null
}

/**
 * Strip a role down to what the server accepts.
 *
 * Sending back server-assigned fields (id, status, sessionID) on a role input
 * is at best ignored and at worst rejected, and a role carrying a stale
 * sessionID is a particularly confusing thing to persist.
 */
export function toRoleInput(role: Partial<Role> & { name?: string; instructions?: string }): RoleInput {
  const out: RoleInput = {
    name: (role.name ?? "").trim(),
    instructions: (role.instructions ?? "").trim(),
  }
  if (role.agent?.trim()) out.agent = role.agent.trim()
  if (role.skill?.trim()) out.skill = role.skill.trim()
  if (role.providerID) out.providerID = role.providerID
  if (role.modelID) out.modelID = role.modelID
  if (role.variant?.trim()) out.variant = role.variant.trim()
  if (role.modelProfile?.trim()) out.modelProfile = role.modelProfile.trim()
  return out
}

/**
 * Guard the destructive save.
 *
 * `PATCH` replaces the role set, so saving an array that is empty — or that
 * lost roles because the swarm hadn't finished loading — deletes them on the
 * server. Refusing an empty save is cheap insurance against turning a rename
 * into a wipe.
 */
export function canSaveRoles(roles: RoleInput[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.length > 0
}

// --- list edits ---

export function addRole(roles: RoleInput[], role: RoleInput): RoleInput[] {
  return [...(roles ?? []), role]
}

export function updateRole(roles: RoleInput[], index: number, patch: Partial<RoleInput>): RoleInput[] {
  const list = roles ?? []
  if (index < 0 || index >= list.length) return list
  return list.map((role, i) => (i === index ? { ...role, ...patch } : role))
}

/** Removing a role is a local edit; it only reaches the server on save. */
export function removeRole(roles: RoleInput[], index: number): RoleInput[] {
  const list = roles ?? []
  if (index < 0 || index >= list.length) return list
  return list.filter((_, i) => i !== index)
}

/**
 * Reorder. The server stores `sortOrder`, and array position is what
 * determines it on save, so moving an item is the whole feature.
 */
export function moveRole(roles: RoleInput[], from: number, to: number): RoleInput[] {
  const list = [...(roles ?? [])]
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list
}

// --- skills ---

export interface Skill {
  name: string
  description?: string
}

/**
 * Seed a role from a skill.
 *
 * This is the "easy to create swarms with a skill" path: pick a skill and get
 * a usable role rather than an empty form. The skill name doubles as the role
 * name because that is nearly always what you meant, and it stays editable.
 *
 * `instructions` is seeded from the description, not the skill body: the body
 * is loaded by the agent at run time from `skill`, so copying it in would
 * duplicate it into the prompt and drift the moment the skill changes.
 */
export function roleFromSkill(skill: Skill): RoleInput {
  const name = skill.name.trim()
  return {
    name: humanizeSkillName(name),
    skill: name,
    instructions: skill.description?.trim() || `Use the ${name} skill.`,
  }
}

/** "release-engineer" -> "Release Engineer". */
export function humanizeSkillName(name: string): string {
  return name
    .split(/[-_.:\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** Skills not already used by a role, so the picker doesn't offer duplicates. */
export function unusedSkills(skills: Skill[], roles: RoleInput[]): Skill[] {
  const used = new Set((roles ?? []).map((role) => role.skill).filter(Boolean))
  return (skills ?? []).filter((skill) => !used.has(skill.name))
}
