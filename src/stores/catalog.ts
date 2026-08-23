import { create } from "zustand"
import { useConnections } from "./connections"
import type { Agent, Command } from "../lib/sdk"
import { chooseModelSelection } from "../lib/model-selection"
import { applySwarmTitles, catalogModelName } from "../lib/model-label"

export interface ProviderModel {
  id: string
  name: string
  reasoning: boolean
  attachment: boolean
  limit?: { context: number; output: number }
  variants?: Record<string, { reasoningEffort?: string }>
}

export interface Provider {
  id: string
  name: string
  connected: boolean
  models: ProviderModel[]
}

interface ModelSelection {
  providerID: string
  modelID: string
}

function sameModel(left: ModelSelection | null, right: ModelSelection | null) {
  return left?.providerID === right?.providerID && left?.modelID === right?.modelID
}

interface CatalogState {
  agents: Agent[]
  commands: Command[]
  providers: Provider[]
  defaults: Record<string, string>
  // Current selections
  agent: string // agent name, e.g. "build"
  model: ModelSelection | null
  variant: string | null // model variant for reasoning effort (e.g. "low", "medium", "high")
  loaded: boolean

  // Actions
  load: () => Promise<void>
  /**
   * Re-read swarm titles and patch the catalog's swarm provider names.
   *
   * Swarm edits used to leave every surface outside Settings (composer chip,
   * model picker, session list headers) showing the stale team name, because
   * titles are baked in at load time. Cheap targeted refresh after a save or
   * delete; no-op before any connection exists.
   */
  refreshSwarms: () => Promise<void>
  setAgent: (name: string) => void
  restoreAgent: (name: string) => void
  setModel: (selection: ModelSelection | null) => void
  setVariant: (variant: string | null) => void
  cycleAgent: (direction?: 1 | -1) => void
}

export const useCatalog = create<CatalogState>((set, get) => ({
  agents: [],
  commands: [],
  providers: [],
  defaults: {},
  agent: "",
  model: null,
  variant: null,
  loaded: false,

  load: async () => {
    const connections = useConnections.getState()
    const client = connections.client
    if (!client) return
    // Swarms are server-wide, not directory-scoped. A project client can list
    // provider facades but may fail to resolve their global display metadata.
    const globalClient = connections.clientForDirectory(undefined) || client

    const [agentResult, commandResult, providerResult, swarmResult] = await Promise.all([
      client.agent.list().catch(() => [] as Agent[]),
      client.command.list().catch(() => [] as Command[]),
      client.provider.list().catch(() => null),
      globalClient.swarm.list().catch(() => []),
    ])

    const agents = Array.isArray(agentResult) ? agentResult : []
    const commands = Array.isArray(commandResult) ? commandResult : []

    // Parse provider response: { all: [...], default: {...}, connected: [...] }
    const raw = providerResult
    const connected = new Set(Array.isArray(raw?.connected) ? raw.connected : [])
    const defaults = raw?.default || {}
    const providers: Provider[] = Array.isArray(raw?.all)
      ? raw.all
          .filter((p) => connected.has(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name || p.id,
            connected: connected.has(p.id),
            models: Object.values(p.models || {})
              .filter((m) => m.status !== "deprecated")
              .map((m) => ({
                id: m.id,
                name: catalogModelName(p.id, m, swarmResult),
                reasoning: m.reasoning ?? false,
                attachment: m.attachment ?? false,
                limit: m.limit,
                variants: m.variants,
              })),
          }))
          .filter((p) => p.models.length > 0)
      : []

    // Filter out hidden agents
    const visible = agents.filter((a) => !a.hidden)

    // Default agent
    const current = get().agent
    const agent = current && visible.some((a) => a.name === current) ? current : visible[0]?.name || "build"

    // Default model: keep valid existing selection; otherwise prefer connected
    // provider defaults, then first connected model; agent model is last fallback.
    const existing = get().model
    const defaultAgent = visible[0]
    const model = chooseModelSelection({
      providers,
      defaults,
      existing,
      agentModel: defaultAgent?.model || null,
    })

    set((state) => ({
      agents: visible,
      commands,
      providers,
      defaults,
      agent,
      model,
      variant: sameModel(state.model, model) ? state.variant : null,
      loaded: true,
    }))
  },

  refreshSwarms: async () => {
    const connections = useConnections.getState()
    const globalClient = connections.clientForDirectory(undefined) || connections.client
    if (!globalClient) return
    const swarms = await globalClient.swarm.list().catch(() => null)
    if (!swarms) return
    set((state) => ({ providers: applySwarmTitles(state.providers, swarms) }))
  },

  setAgent: (name) => {
    const match = get().agents.find((a) => a.name === name)
    if (!match) return
    const model = match.model || get().model
    set((state) => ({
      agent: name,
      model,
      variant: sameModel(state.model, model) ? state.variant : null,
    }))
  },

  // Session hydration restores only the persisted mode. Model selection is a
  // separate axis and may be a swarm facade that an agent default must not
  // replace.
  restoreAgent: (name) => {
    if (!get().agents.some((agent) => agent.name === name)) return
    set({ agent: name })
  },

  setModel: (selection) =>
    set((state) => ({
      model: selection,
      variant: sameModel(state.model, selection) ? state.variant : null,
    })),

  setVariant: (variant) => set({ variant }),

  cycleAgent: (direction = 1) => {
    const { agents, agent } = get()
    const primary = agents.filter((a) => a.mode === "primary" || a.mode === "all")
    if (primary.length < 2) return
    const idx = primary.findIndex((a) => a.name === agent)
    const next = (idx + direction + primary.length) % primary.length
    get().setAgent(primary[next].name)
  },
}))
