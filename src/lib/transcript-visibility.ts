interface MessageLike {
  role?: string
  error?: {
    name?: string
    message?: string
    data?: unknown
  }
}

interface PartLike {
  type?: string
  text?: string
  mime?: string
  synthetic?: boolean
  ignored?: boolean
  metadata?: Record<string, unknown>
}

const SYNTHETIC_USER_ENVELOPE = /^\s*<(?:task(?:\s[^>]*)?|swarm-briefing(?:\s[^>]*)?|system-reminder(?:\s[^>]*)?)>[\s\S]*<\/(?:task|swarm-briefing|system-reminder)>\s*$/

function isBookkeepingText(part: PartLike): boolean {
  return Boolean(
    part.synthetic || part.ignored || (part.synthetic === undefined && part.metadata?.compaction_continue === true),
  )
}

function isHiddenUserText(part: PartLike): boolean {
  return isBookkeepingText(part) || SYNTHETIC_USER_ENVELOPE.test(part.text ?? "")
}

/**
 * Internal task reports are user-role messages addressed to an assistant.
 *
 * A user message is hidden only when it carries NO reader-visible content:
 * every text part is assistant-audience (synthetic/ignored/compaction
 * bookkeeping/envelope) and nothing else renders. Swarm sessions attach a
 * synthetic briefing part alongside the human's own text — hiding on ANY such
 * part erased the human's message from the transcript entirely.
 */
export function isHiddenSyntheticUserMessage(message: MessageLike, parts: PartLike[] | null | undefined): boolean {
  if (message.role !== "user") return false
  const all = parts ?? []
  const textParts = all.filter((part) => part.type === "text")
  if (textParts.length === 0) return false
  if (!textParts.every(isHiddenUserText)) return false
  return visibleTranscriptParts(all.filter((part) => part.type !== "text")).length === 0
}

export function visibleTranscriptEntry<M extends MessageLike & { time?: { completed?: number } }, P extends PartLike>(
  message: M,
  parts: P[] | null | undefined,
): { message: M; parts: P[] } | undefined {
  if (isHiddenSyntheticUserMessage(message, parts)) return undefined
  const visible = visibleTranscriptParts(parts)
  // Kept when there is content OR any notice to show (explicit error, or
  // the synthesized missing-response notice for finalized-empty messages).
  if (visible.length === 0 && !messageNoticeText(message, parts)) return undefined
  return { message, parts: visible }
}

// This allowlist follows MessageBubble's actual render paths. Server envelopes
// may also contain bookkeeping parts, but admitting those creates chrome-only
// cards while their reader-visible parts are still absent or never arrive.
export function visibleTranscriptParts<P extends PartLike>(parts: P[] | null | undefined): P[] {
  return (parts ?? []).filter((part) => {
    // Bookkeeping text (synthetic/ignored/compaction continuation) never
    // renders — including when it rides along with the human's own text.
    if (part.type === "text") return !isBookkeepingText(part) && Boolean(part.text?.trim())
    if (part.type === "reasoning") return Boolean(part.text?.trim())
    if (part.type === "tool") return true
    return part.type === "file" && Boolean(part.mime?.startsWith("image/"))
  })
}

export function messageErrorText(message: MessageLike): string | undefined {
  if (message.role !== "assistant" || !message.error || message.error.name === "MessageAbortedError") return undefined

  const data = message.error.data
  const detail = (
    message.error.message ||
    (data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "")
  ).trim()
  const title = errorTitle(message.error.name)
  return detail ? `${title}: ${detail}` : title
}

function errorTitle(name?: string) {
  if (name === "ProviderAuthError") return "Provider not connected"
  if (name === "MessageOutputLengthError") return "Response hit the output limit"
  if (name === "ContextOverflowError") return "Context window overflowed"
  if (name === "StructuredOutputError") return "Structured output failed"
  if (name === "APIError") return "Provider request failed"
  return "Something went wrong"
}

/** Finalized = the server closed this message: completed stamp or an error. */
export function isFinalizedMessage(message: MessageLike & { time?: { completed?: number } }): boolean {
  return Boolean(message.time?.completed) || Boolean(message.error)
}

export const MISSING_RESPONSE_NOTICE =
  "No response was received — delivery may have failed. Ask again to retry."

/**
 * The one notice a bubble may need: an explicit error wins; otherwise a
 * FINALIZED assistant message with nothing visible synthesizes a
 * delivery-failure notice rather than rendering blank or vanishing.
 *
 * Two deliberate exclusions:
 * - In-flight messages: streaming messages are born empty; emptiness only
 *   means something after finalization.
 * - Structural messages: one that carries deliberately-hidden text
 *   (synthetic/ignored — briefings, compaction bookkeeping) is empty by
 *   DESIGN, not by loss, and creates no card at all.
 *
 * Self-correcting for transient loss: if the missing content arrives later
 * (observed in the wild — a relay flush landing after finalization), the
 * visible parts appear and the notice evaporates on the same render pass.
 */
export function messageNoticeText(
  message: MessageLike & { time?: { completed?: number } },
  parts: PartLike[] | null | undefined,
): string | undefined {
  const explicit = messageErrorText(message)
  if (explicit) return explicit
  if (message.role !== "assistant") return undefined
  // An aborted run has no content because the USER stopped it — expected
  // silence, not lost delivery.
  if (message.error?.name === "MessageAbortedError") return undefined
  if (!isFinalizedMessage(message)) return undefined
  if (visibleTranscriptParts(parts).length > 0) return undefined
  const structural = (parts ?? []).some(
    (part) => part.type === "text" && isBookkeepingText(part) && Boolean(part.text?.trim()),
  )
  if (structural) return undefined
  return MISSING_RESPONSE_NOTICE
}
