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
 * Skip a command's environment preamble to reach its intent.
 *
 * Agents habitually prefix real work with setup — `export PATH=…; cd …deep
 * path… && VAR=x actual-command` — and the card titled itself with the
 * `export` (seen on device: a 46-minute task running under a title of
 * `export PATH="/opt/homebre…`). The preamble is the least informative part
 * of the line; step over leading `export X=…`, `cd …`, and bare `VAR=…`
 * assignments (each ended by `;` or `&&`) until something else appears.
 * A line that is ONLY preamble keeps its head — an honest nothing.
 */
export function commandIntent(command: string): string {
  const preamble = /^(export\s+[A-Za-z_][A-Za-z0-9_]*=|cd\s|[A-Za-z_][A-Za-z0-9_]*=\S*$)/
  // Scan LINES too, not just the first: scripts often spend line one entirely
  // on env setup (`export PATH=…; S=…`) and do the work on line two — seen on
  // device as a card titled "S=38141FDJG00BG7".
  for (const rawLine of command.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const segments = line.split(/\s*(?:;|&&)\s*/)
    let index = 0
    while (index < segments.length && preamble.test(segments[index].trim())) index++
    const rest = segments.slice(index).join(" && ").trim()
    if (rest) return rest
  }
  return command.split("\n")[0].trim()
}

/**
 * A one-line description of the call.
 *
 * Preference order: the server's own title (it is written for humans), then
 * an input-derived description, then the bare tool name as the floor — which
 * is exactly what every card showed before.
 */
export function toolCallTitle(part: ToolLike): string {
  const tool0 = part.tool ?? ""
  const serverTitle = str(part.state?.title)
  // The server stamps a PLACEHOLDER title equal to the tool name when the
  // call starts ("bash"), replacing it with a description later or never.
  // Verified against the live API: recent parts return title "bash" while
  // input.command carries the real intent. A title that just repeats the
  // tool name adds nothing, so it falls through to input derivation.
  if (serverTitle && serverTitle.toLowerCase() !== tool0.toLowerCase()) return serverTitle

  const tool = part.tool ?? ""
  const input = record(part.state?.input)

  switch (tool) {
    case "bash": {
      const command = str(input?.command)
      if (command) return firstLine(commandIntent(command))
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
      // The swarm dispatch path sends no description — the card sat on the
      // bare floor ("task") for a 46-minute run while every OTHER surface
      // showed the spawned session's real name. The session-title lookup
      // needs the store, so it lives in ToolCallCard (taskTitleFrom below
      // ranks what THIS pure layer can know).
      const description = str(input?.description) ?? str(input?.summary)
      if (description) return description
      const prompt = str(input?.prompt)
      if (prompt) return firstLine(prompt)
      break
    }
    case "todowrite":
      return "update todos"
    case "skill": {
      const name = str(input?.name) ?? str(input?.skill)
      if (name) return `skill: ${name}`
      break
    }
    case "graph_plan": {
      const goal = str(input?.goal)
      if (goal) return firstLine(goal)
      break
    }
    case "sendmessage": {
      const to = str(input?.to)
      const summary = str(input?.summary)
      if (summary) return firstLine(summary)
      if (to) return `message ${firstLine(to, 30)}`
      break
    }
    case "agent": {
      const description = str(input?.description)
      if (description) return description
      const prompt = str(input?.prompt)
      if (prompt) return firstLine(prompt)
      break
    }
    case "monitor": {
      const description = str(input?.description)
      if (description) return `watch: ${firstLine(description, 50)}`
      const command = str(input?.command)
      if (command) return `watch: ${firstLine(commandIntent(command), 50)}`
      break
    }
    case "question": {
      const questions = input?.questions
      if (Array.isArray(questions)) {
        const first = record(questions[0])
        const text = str(first?.question) ?? str(first?.header)
        if (text) return firstLine(text)
      }
      break
    }
    case "taskcreate": {
      const subject = str(input?.subject)
      if (subject) return `+ ${firstLine(subject, 50)}`
      break
    }
    case "taskupdate": {
      const id = str(input?.taskId)
      const status = str(input?.status)
      if (id) return `task #${id}${status ? ` → ${status}` : ""}`
      break
    }
    case "taskstop":
      return "stop background task"
    case "schedulewakeup": {
      if (input?.stop === true) return "stop loop"
      const delay = input?.delaySeconds
      if (typeof delay === "number") return `wake in ${Math.round(delay / 60)}m`
      break
    }
    case "opencodex_swarm_create": {
      const prompt = str(input?.prompt)
      if (prompt) return firstLine(prompt)
      break
    }
    case "browser_navigate": {
      const url = str(input?.url)
      if (url) {
        try {
          return `open ${new URL(url).hostname}`
        } catch {
          return `open ${firstLine(url, 40)}`
        }
      }
      break
    }
    case "graph_status": {
      const node = str(input?.nodeID)
      return node ? `graph status ${node}` : "graph status"
    }
    case "toolsearch": {
      const query = str(input?.query)
      if (query) return `toolsearch ${firstLine(query, 40)}`
      break
    }
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
