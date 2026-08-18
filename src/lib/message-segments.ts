// The shape of a streamed reply, preserved.
//
// A message's parts arrive in order: prose, then some tool calls, more
// prose, more calls. Joining all text into one blob and clumping every tool
// at the end erased the story — WHERE the assistant stopped to run something
// is context, not noise ("I ran this, saw that, so I did X" reads as lies
// when the tools all render after the conclusion).
//
// Segments preserve the interleaving: consecutive text parts merge into one
// prose block, consecutive tool parts merge into one run. The renderer shows
// a short run as inline links and a long one as a summary row — the reader
// controls how deep to go either way.
//
// Pure, so the segmentation is testable under plain `node --test`.

interface PartLike {
  type?: string
  text?: string
  synthetic?: boolean
}

export type MessageSegment<P extends PartLike = PartLike> =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: P[] }

export function segmentParts<P extends PartLike>(parts: P[] | null | undefined): MessageSegment<P>[] {
  const segments: MessageSegment<P>[] = []
  for (const part of parts ?? []) {
    if (part.type === "text") {
      const text = part.text ?? ""
      if (!text.trim()) continue
      const last = segments[segments.length - 1]
      if (last?.kind === "text") last.text += `\n${text}`
      else segments.push({ kind: "text", text })
    } else if (part.type === "tool") {
      const last = segments[segments.length - 1]
      if (last?.kind === "tools") last.tools.push(part)
      else segments.push({ kind: "tools", tools: [part] })
    }
    // Other part types (reasoning, files, step markers) render elsewhere.
  }
  return segments
}
