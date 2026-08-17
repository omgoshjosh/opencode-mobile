// Aggregates for the Session Hub screen.
//
// Everything here is computed from messages already in the store — the hub
// adds a place to see it, not a new fetch. Pure, so the sums are testable
// under plain `node --test`.

import type { Message } from "./sdk"

export interface SessionStats {
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Distinct execution models, in first-use order. The swarm facade never
   * appears here — assistant messages carry the real model. */
  models: string[]
  userMessages: number
  assistantMessages: number
}

export function sessionStats(messages: Message[] | null | undefined): SessionStats {
  const stats: SessionStats = {
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    models: [],
    userMessages: 0,
    assistantMessages: 0,
  }

  for (const message of messages ?? []) {
    if (message.role === "user") {
      stats.userMessages++
      continue
    }
    stats.assistantMessages++
    stats.cost += message.cost ?? 0
    stats.inputTokens += message.tokens?.input ?? 0
    stats.outputTokens += message.tokens?.output ?? 0
    stats.cacheReadTokens += message.tokens?.cache?.read ?? 0
    if (message.modelID && !stats.models.includes(message.modelID)) {
      stats.models.push(message.modelID)
    }
  }

  return stats
}

/** "1.2M" / "45.3k" / "812" — token counts get long fast. */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
