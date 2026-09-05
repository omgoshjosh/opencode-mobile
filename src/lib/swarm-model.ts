// Swarm-aware model selection.
//
// A swarm is exposed by the server as a synthetic provider: a session running
// a swarm persists `session.model = { providerID: "swarm", id: <swarmID> }`.
// That value is a *facade* — the orchestrator actually executes on a concrete
// model (e.g. `openai/gpt-5.6-sol`), and each assistant message records that
// resolved execution identity, not the swarm.
//
// The bug this guards against: the session screen syncs its model chip from
// the latest assistant message. After one swarm reply that sync overwrote the
// `swarm/<id>` facade with the execution model, so the *next* prompt was sent
// as `openai/gpt-5.6-sol` — which replaces the persisted facade server-side and
// silently drops the session out of swarm mode. The user had to reselect the
// swarm before every single message.
//
// The desktop GUI never had this problem because it restores composer state
// from the persisted `session.model` and treats `swarm/<id>` as a first-class
// selection (packages/gui/src/renderer/src/lib/model-selection.ts).
//
// Kept dependency-free so it's testable under plain `node --test`.

export const SWARM_PROVIDER_ID = "swarm"

export interface ModelSelection {
  providerID: string
  modelID: string
}

// Shape the server persists on the session row. Note it uses `id`, while
// message-derived selections and the mobile catalog store use `modelID` —
// normalizing that mismatch is half the reason this module exists.
export interface SessionModel {
  providerID: string
  id: string
  variant?: string
}

/**
 * Decide which agent the composer should restore for a session.
 *
 * `session.agent` is not updated for every prompt, so a session whose last user
 * message ran under `goal` can still read `build` (or nothing) on the session
 * row — which is how the footer chip ended up showing the wrong mode. The
 * transcript is the more recent evidence, so it wins when present.
 */
export function resolveSessionAgent(input: {
  lastUserMessageAgent?: string | null
  sessionAgent?: string | null
  availableAgents: readonly string[]
  selectionTouched?: boolean
}): string | null {
  if (input.selectionTouched) return null
  const agent = input.lastUserMessageAgent || input.sessionAgent
  if (!agent) return null
  return input.availableAgents.includes(agent) ? agent : null
}

export function sessionPromptSelection(input: {
  agent?: string | null
  model?: ModelSelection | null
}): { agent?: string; model?: ModelSelection } {
  return {
    agent: input.agent || undefined,
    model: input.model || undefined,
  }
}

export function isSwarmSelection(selection: ModelSelection | null | undefined): boolean {
  return selection?.providerID === SWARM_PROVIDER_ID
}

// Normalize the persisted session.model into the catalog store's shape.
export function sessionModelSelection(sessionModel: SessionModel | null | undefined): ModelSelection | null {
  if (!sessionModel?.providerID || !sessionModel.id) return null
  return { providerID: sessionModel.providerID, modelID: sessionModel.id }
}

/**
 * Decide which model the composer should show for a session.
 *
 * Rules, in order:
 *
 * 1. If the session is persisted as a swarm, that always wins. An assistant
 *    message's resolved execution model must never replace it — that is the
 *    exact overwrite that dropped the user out of swarm mode.
 * 2. Otherwise prefer the model derived from the conversation, preserving the
 *    existing behavior for ordinary models (an in-session model switch is
 *    reflected by the messages before the session row catches up).
 * 3. Otherwise fall back to the persisted session model, which is what makes a
 *    cold open / reload / reconnect restore the right selection instead of
 *    showing nothing.
 *
 * Returns null when there is nothing to apply, so callers can leave the
 * current selection untouched rather than clearing it.
 */
export function resolveSessionModel(input: {
  sessionModel?: SessionModel | null
  fromMessages?: ModelSelection | null
}): ModelSelection | null {
  const persisted = sessionModelSelection(input.sessionModel)
  if (isSwarmSelection(persisted)) return persisted
  return input.fromMessages ?? persisted
}
