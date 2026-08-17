// What a tool call is FOR, not just what tool it used.
//
// A transcript full of cards that all say "bash" answers nothing — thirteen
// identical rows were literally on screen during review. The server sometimes
// supplies `state.title` with a human description; when it doesn't, the
// call's own input almost always names the intent: the command being run, the
// file being read, the pattern being searched.
//
// Pure, so the derivations are testable under plain `node --test`.

interface ToolLike {
  tool?: string
  state?: { title?: string; input?: unknown }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** First line, trimmed and capped — a shell command's intent is its head. */
function firstLine(text: string, max = 60): string {
  const line = text.split("\n")[0].trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * A one-line description of the call.
 *
 * Preference order: the server's own title (it is written for humans), then
 * an input-derived description, then the bare tool name as the floor — which
 * is exactly what every card showed before.
 */
export function toolCallTitle(part: ToolLike): string {
  const serverTitle = str(part.state?.title)
  if (serverTitle) return serverTitle

  const tool = part.tool ?? ""
  const input = record(part.state?.input)

  switch (tool) {
    case "bash": {
      const command = str(input?.command)
      if (command) return firstLine(command)
      break
    }
    case "read":
    case "write":
    case "edit":
    case "apply_patch": {
      const path = str(input?.filePath) ?? str(input?.file_path) ?? str(input?.path)
      if (path) return `${tool} ${basename(path)}`
      break
    }
    case "glob":
    case "grep":
    case "codesearch": {
      const pattern = str(input?.pattern) ?? str(input?.query)
      if (pattern) return `${tool} ${firstLine(pattern, 40)}`
      break
    }
    case "webfetch":
    case "websearch": {
      const url = str(input?.url)
      if (url) {
        try {
          return `${tool} ${new URL(url).hostname}`
        } catch {
          return `${tool} ${firstLine(url, 40)}`
        }
      }
      const query = str(input?.query)
      if (query) return `${tool} ${firstLine(query, 40)}`
      break
    }
    case "task": {
      const description = str(input?.description)
      if (description) return description
      break
    }
    case "todowrite":
      return "update todos"
  }

  return tool || "tool"
}

export interface ToolRunSummary {
  count: number
  failed: number
  running: number
  /** Titles of the first few calls, for the collapsed row's preview line. */
  preview: string[]
}

/**
 * Summarise a run of tool calls for a collapsed row.
 *
 * `failed` and `running` are surfaced because they are the two states that
 * change whether you'd bother expanding: a failure needs reading, a running
 * call means the row is still growing.
 */
export function summarizeToolRun(parts: ToolLike[], previewCount = 2): ToolRunSummary {
  const list = parts ?? []
  return {
    count: list.length,
    failed: list.filter((p) => (p as { state?: { status?: string } }).state?.status === "error").length,
    running: list.filter((p) => {
      const status = (p as { state?: { status?: string } }).state?.status
      return status === "running" || status === "pending"
    }).length,
    preview: list.slice(0, previewCount).map(toolCallTitle),
  }
}

/**
 * Should a message's tool calls collapse into a summary row?
 *
 * Below the threshold, inline cards are still legible and one tap cheaper.
 * At four and above the transcript stops being a conversation — the observed
 * failure was thirteen consecutive identical cards.
 */
export const TOOL_RUN_COLLAPSE_THRESHOLD = 4

export function shouldCollapseToolRun(count: number): boolean {
  return count >= TOOL_RUN_COLLAPSE_THRESHOLD
}
