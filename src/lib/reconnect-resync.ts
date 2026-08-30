import { isSessionActuallyIdle } from "./session-status-reconcile.ts"
import type { Client } from "./sdk"

export async function resyncBusySession(input: {
  client: Pick<Client, "session">
  sessionID: string
  isBusy: () => boolean
  canApply: () => boolean
  markIdle: () => void
}) {
  const response = await input.client.session.messages(input.sessionID, { limit: 1 })
  const messages = (response || []).map((message) => message.info)
  if (!isSessionActuallyIdle(messages)) return
  if (!input.isBusy() || !input.canApply()) return
  input.markIdle()
}
