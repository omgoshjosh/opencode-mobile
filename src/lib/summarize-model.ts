// Which model should run a /compact (summarize)?
//
// The server's summarize endpoint wants a REAL provider/model pair. A swarm
// session's facade ("swarm/swm_...") is not one — but every assistant reply
// records the execution model that actually ran, which is exactly the right
// engine to also write the summary. Fall back to the caller's default when
// the transcript has no assistant reply yet.
//
// Pure, so the choice is testable under plain `node --test`.

interface MessageLike {
  role?: string
  providerID?: string
  modelID?: string
}

export function summarizeModel(
  messages: readonly MessageLike[] | null | undefined,
  fallback: { providerID: string; modelID: string } | null,
): { providerID: string; modelID: string } | null {
  const list = messages ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.role === "assistant" && m.providerID && m.modelID && m.providerID !== "swarm") {
      return { providerID: m.providerID, modelID: m.modelID }
    }
  }
  if (fallback && fallback.providerID !== "swarm") return fallback
  return null
}
