export type MessageCancelOutcome = "cancelled" | "running" | "settled" | "missing"

export function messageCancelOutcome(value: unknown): MessageCancelOutcome {
  const outcome = typeof value === "object" && value ? (value as { outcome?: unknown }).outcome : undefined
  if (outcome === "cancelled" || outcome === "running" || outcome === "settled" || outcome === "missing") return outcome
  throw new Error("Invalid message cancellation response")
}
