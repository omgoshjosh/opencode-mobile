export function warmSessionFor<T extends { id: string }>(sessions: T[], sessionID: string, canWarmStart: boolean): T | undefined {
  if (!canWarmStart) return undefined
  return sessions.find((session) => session.id === sessionID)
}
