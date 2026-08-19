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
}

export function visibleTranscriptEntry<M extends MessageLike, P extends PartLike>(
  message: M,
  parts: P[] | null | undefined,
): { message: M; parts: P[] } | undefined {
  const visible = visibleTranscriptParts(parts)
  if (visible.length === 0 && !messageErrorText(message)) return undefined
  return { message, parts: visible }
}

// This allowlist follows MessageBubble's actual render paths. Server envelopes
// may also contain bookkeeping parts, but admitting those creates chrome-only
// cards while their reader-visible parts are still absent or never arrive.
export function visibleTranscriptParts<P extends PartLike>(parts: P[] | null | undefined): P[] {
  return (parts ?? []).filter((part) => {
    if (part.type === "text") return !part.synthetic && !part.ignored && Boolean(part.text?.trim())
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
