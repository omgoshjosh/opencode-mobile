import { useState, useCallback, useEffect } from "react"
import { LIVE_TICK_MS, formatElapsed } from "../../lib/elapsed-format"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { router } from "expo-router"
import type { Part } from "../../lib/sdk"
import { DiffView } from "./DiffView"
import { isSubagentOpenable, subagentBadge, subagentLinkFrom } from "../../lib/subagent-link"
import { toolCallTitle } from "../../lib/tool-titles"
import { useViewer } from "../../stores/viewer"
import { useSessions } from "../../stores/sessions"

const TOOL_ICONS: Record<string, string> = {
  read: "glasses-outline",
  list: "list-outline",
  glob: "search-outline",
  grep: "search-outline",
  webfetch: "globe-outline",
  edit: "code-slash-outline",
  write: "create-outline",
  apply_patch: "git-merge-outline",
  bash: "terminal-outline",
  task: "git-branch-outline",
  todowrite: "checkbox-outline",
  todoread: "checkbox-outline",
  question: "chatbubble-ellipses-outline",
  codesearch: "search-outline",
  websearch: "globe-outline",
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

function statusColor(status: string): string {
  if (status === "completed") return "#22c55e"
  if (status === "error") return "#ef4444"
  if (status === "running") return "#f59e0b"
  return "#888888"
}

// --- Tool-specific detail renderers ---

function BashDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const cmd = typeof input === "object" && input !== null ? (input as Record<string, unknown>).command : undefined
  const out = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof cmd === "string" && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable>
            <Text style={s.codePrompt}>$ </Text>
            {cmd}
          </Text>
        </View>
      )}
      {out !== undefined && out.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={80}>
            {out}
          </Text>
        </View>
      )}
    </View>
  )
}

function ReadDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const offset = typeof input === "object" && input !== null ? (input as Record<string, unknown>).offset : undefined
  const limit = typeof input === "object" && input !== null ? (input as Record<string, unknown>).limit : undefined
  const range = offset || limit ? ` (${offset || 0}..${limit || "end"})` : ""
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
          {range}
        </Text>
      )}
    </View>
  )
}

function WriteDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const content = typeof input === "object" && input !== null ? (input as Record<string, unknown>).content : undefined
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {typeof content === "string" && content.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={40}>
            {content}
          </Text>
        </View>
      )}
    </View>
  )
}

function EditDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const old = typeof input === "object" && input !== null ? (input as Record<string, unknown>).oldString : undefined
  const replacement =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).newString : undefined

  // If we have old/new strings, show as diff
  if (typeof old === "string" && typeof replacement === "string") {
    return (
      <View style={s.detailSection}>
        {typeof file === "string" && (
          <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
            {file}
          </Text>
        )}
        <DiffView before={old} after={replacement} isDark={isDark} />
      </View>
    )
  }

  // Fallback: show raw output
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2)
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {text && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={40}>
            {text}
          </Text>
        </View>
      )}
    </View>
  )
}

function PatchDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const patch = typeof input === "object" && input !== null ? (input as Record<string, unknown>).patch : undefined
  return (
    <View style={s.detailSection}>
      {typeof patch === "string" && patch.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={60}>
            {patch}
          </Text>
        </View>
      )}
    </View>
  )
}

function GlobGrepDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const { t } = useTranslation()
  const pattern = typeof input === "object" && input !== null ? (input as Record<string, unknown>).pattern : undefined
  const path = typeof input === "object" && input !== null ? (input as Record<string, unknown>).path : undefined
  const results = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof pattern === "string" && (
        <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>
          {typeof path === "string"
            ? t("chat.toolCallCard.patternWithPath", { pattern, path })
            : t("chat.toolCallCard.patternOnly", { pattern })}
        </Text>
      )}
      {results && results.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
            {results}
          </Text>
        </View>
      )}
    </View>
  )
}

function WebfetchDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const url = typeof input === "object" && input !== null ? (input as Record<string, unknown>).url : undefined
  return (
    <View style={s.detailSection}>
      {typeof url === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark, { color: "#8b5cf6" }]} selectable numberOfLines={3}>
          {url}
        </Text>
      )}
    </View>
  )
}

function TaskDetail({ tool, isDark }: { tool: Part; isDark: boolean }) {
  const input = tool.state?.input
  const description =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).description : undefined
  const prompt = typeof input === "object" && input !== null ? (input as Record<string, unknown>).prompt : undefined

  // A `task` call spawns a real session on the server. Until now the
  // transcript showed the prompt and stopped, leaving the subagent's actual
  // work unreachable — see src/lib/subagent-link.ts.
  const link = subagentLinkFrom(tool)
  const badge = link ? subagentBadge(link) : undefined
  const directory = useSessions((st) => st.currentSession?.directory)

  const openSubagent = useCallback(() => {
    if (!link) return
    router.push({
      pathname: "/session/[id]",
      // The child runs in the parent's directory; passing it keeps the child
      // screen on the same connection instead of falling back to the active
      // one, which may point elsewhere.
      params: { id: link.sessionID, ...(directory ? { directory } : {}) },
    })
  }, [link?.sessionID, directory])

  return (
    <View style={s.detailSection}>
      {typeof description === "string" && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{description}</Text>}

      {link && isSubagentOpenable(link) && (
        <TouchableOpacity
          style={[s.subagentLink, isDark && s.subagentLinkDark]}
          onPress={openSubagent}
          activeOpacity={0.7}
          testID={`open-subagent-${link.sessionID}`}
        >
          <Ionicons name="git-branch-outline" size={14} color="#8b5cf6" />
          <Text style={s.subagentLinkText} numberOfLines={1}>
            {link.status === "running" ? "Watch subagent" : "Open subagent"}
          </Text>
          {badge && (
            <View style={s.subagentBadge}>
              <Text style={s.subagentBadgeText} numberOfLines={1}>
                {badge}
              </Text>
            </View>
          )}
          {/* The swarm facade hides which model actually ran; this is the
              only place it surfaces. */}
          {link.modelID && (
            <Text style={[s.subagentModel, isDark && s.detailMetaDark]} numberOfLines={1}>
              {link.modelID}
            </Text>
          )}
          <Ionicons name="chevron-forward" size={14} color="#8b5cf6" />
        </TouchableOpacity>
      )}

      {typeof prompt === "string" && prompt.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={20}>
            {prompt}
          </Text>
        </View>
      )}
    </View>
  )
}

function TodoDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const todos = typeof input === "object" && input !== null ? (input as Record<string, unknown>).todos : undefined
  if (!Array.isArray(todos)) return null
  return (
    <View style={s.detailSection}>
      {todos.map((t, i) => {
        const item = t as Record<string, unknown>
        const done = item.status === "completed"
        return (
          <View key={String(item.id || i)} style={s.todoRow}>
            <Ionicons
              name={done ? "checkbox" : "square-outline"}
              size={16}
              color={done ? "#22c55e" : isDark ? "#9a9a9a" : "#999999"}
            />
            <Text style={[s.todoText, isDark && s.todoTextDark, done && s.todoDone]} numberOfLines={2}>
              {String(item.content || item.title || "")}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function GenericDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const text =
    typeof output === "string"
      ? output
      : output !== undefined && output !== null
        ? JSON.stringify(output, null, 2)
        : typeof input === "object" && input !== null
          ? JSON.stringify(input, null, 2)
          : undefined
  if (!text || text.length === 0) return null
  return (
    <View style={s.detailSection}>
      <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
        <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
          {text}
        </Text>
      </View>
    </View>
  )
}

function ToolDetail({ tool, isDark }: { tool: Part; isDark: boolean }) {
  const name = tool.tool || ""
  const input = tool.state?.input
  const output = tool.state?.output

  switch (name) {
    case "bash":
      return <BashDetail input={input} output={output} isDark={isDark} />
    case "read":
      return <ReadDetail input={input} isDark={isDark} />
    case "write":
      return <WriteDetail input={input} isDark={isDark} />
    case "edit":
      return <EditDetail input={input} output={output} isDark={isDark} />
    case "apply_patch":
      return <PatchDetail input={input} isDark={isDark} />
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
      return <GlobGrepDetail input={input} output={output} isDark={isDark} />
    case "webfetch":
    case "websearch":
      return <WebfetchDetail input={input} isDark={isDark} />
    case "task":
      return <TaskDetail tool={tool} isDark={isDark} />
    case "todowrite":
      return <TodoDetail input={input} isDark={isDark} />
    default:
      return <GenericDetail input={input} output={output} isDark={isDark} />
  }
}

function openFullOutput(tool: Part) {
  const input = tool.state?.input
  const inputText =
    typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).command === "string"
      ? ((input as Record<string, unknown>).command as string)
      : null
  useViewer.getState().showToolOutput({
    title: toolCallTitle(tool),
    input: inputText,
    output: typeof tool.state?.output === "string" ? tool.state.output : JSON.stringify(tool.state?.output, null, 2),
  })
  router.push("/tool-output")
}

// --- Error display ---
function ErrorBanner({ message, isDark }: { message: string; isDark: boolean }) {
  return (
    <View style={[s.errorBanner, isDark && s.errorBannerDark]}>
      <Ionicons name="alert-circle" size={14} color="#ef4444" />
      <Text style={s.errorText} numberOfLines={3} selectable>
        {message}
      </Text>
    </View>
  )
}

// --- Duration display ---
// Finished calls: exact span. Running calls: a LIVE wall clock — the elapsed
// figure ticks every second, which is also the difference between "still
// working" and "hung" being visible at a glance. See src/lib/elapsed-format.
function useElapsed(start?: number, end?: number, running?: boolean): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !start || end) return
    const timer = setInterval(() => setNow(Date.now()), LIVE_TICK_MS)
    return () => clearInterval(timer)
  }, [running, start, end])
  if (!start) return null
  if (end) return formatElapsed(end - start)
  if (!running) return null
  return formatElapsed(Math.max(0, now - start))
}

// --- Main component ---
interface Props {
  tool: Part
  isDark: boolean
  /** Open already expanded — used when a deep link lands on this exact call. */
  initiallyExpanded?: boolean
}

export function ToolCallCard({ tool, isDark, initiallyExpanded }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(initiallyExpanded ?? false)
  const icon = (tool.tool && TOOL_ICONS[tool.tool]) || "extension-puzzle-outline"
  const status = tool.state?.status || "pending"
  const color = statusColor(status)
  const error = tool.state?.error?.message
  const isRunning = status === "running" || status === "pending"
  const elapsed = useElapsed(tool.state?.time?.start, tool.state?.time?.end, isRunning)
  const hasDetail = tool.state?.input !== undefined || tool.state?.output !== undefined || error

  const toggle = useCallback(() => {
    if (hasDetail) setExpanded((v) => !v)
  }, [hasDetail])

  return (
    <TouchableOpacity
      style={[
        s.card,
        isDark && s.cardDark,
        status === "error" && s.cardError,
        status === "error" && isDark && s.cardErrorDark,
      ]}
      onPress={toggle}
      activeOpacity={hasDetail ? 0.7 : 1}
    >
      {/* Header row */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name={icon as any} size={16} color={color} />
          {/* What the call is FOR, not just which tool ran — "git status
              --porcelain" instead of a thirteenth card reading "bash". */}
          <Text style={[s.name, isDark && s.nameDark]} numberOfLines={1}>
            {toolCallTitle(tool) || t("chat.toolCallCard.fallbackTitle")}
          </Text>
          {elapsed && (
            <Text style={[s.elapsed, isDark && s.elapsedDark, isRunning && s.elapsedLive]}>{elapsed}</Text>
          )}
        </View>
        <View style={s.headerRight}>
          {status === "running" && <ActivityIndicator size="small" color={color} />}
          {status === "completed" && <Ionicons name="checkmark-circle" size={16} color="#22c55e" />}
          {status === "error" && <Ionicons name="close-circle" size={16} color="#ef4444" />}
          {hasDetail && (
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={isDark ? "#9a9a9a" : "#999999"}
            />
          )}
        </View>
      </View>

      {/* Error banner */}
      {error && !expanded && <ErrorBanner message={error} isDark={isDark} />}

      {/* Expanded detail */}
      {expanded && (
        <ScrollView style={s.detailScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {error && <ErrorBanner message={error} isDark={isDark} />}
          <ToolDetail tool={tool} isDark={isDark} />
        </ScrollView>
      )}
      {/* OUTSIDE the nested ScrollView: a Touchable inside it never received
          taps (the scroll view claimed the gesture — observed on device, the
          button rendered but presses did nothing). Long output in a
          scroll-inside-scroll card is miserable anyway; this pushes a full
          screen with selectable mono text and extracted links. */}
      {expanded && typeof tool.state?.output === "string" && tool.state.output.length > 280 && (
        <TouchableOpacity style={s.openOutput} onPress={() => openFullOutput(tool)} testID="open-full-output">
          <Ionicons name="expand-outline" size={13} color="#6d28d9" />
          <Text style={s.openOutputText}>Open full output</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  cardDark: { backgroundColor: "#2a2a2a", borderColor: "#3a3a3a" },
  cardError: { borderColor: "#fecaca" },
  cardErrorDark: { borderColor: "#7f1d1d" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 13, fontWeight: "500", color: "#0a0a0a", flex: 1 },
  nameDark: { color: "#e5e5e5" },
  elapsed: { fontSize: 11, color: "#999999" },
  elapsedDark: { color: "#9a9a9a" },
  // Amber while ticking: the number moving + the color say "in flight".
  elapsedLive: { color: "#f59e0b", fontWeight: "600" },

  // Error
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
    padding: 8,
    backgroundColor: "#fef2f2",
    borderRadius: 6,
  },
  errorBannerDark: { backgroundColor: "#1a0a0a" },
  errorText: { fontSize: 12, color: "#dc2626", flex: 1, lineHeight: 18 },

  // Detail
  detailScroll: { maxHeight: 300, marginTop: 8 },
  detailSection: { gap: 4 },
  detailFile: {
    fontSize: 12,
    fontFamily: mono,
    color: "#6d28d9",
    backgroundColor: "#f5f3ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
  detailFileDark: { color: "#a78bfa", backgroundColor: "#1a1a2e" },
  openOutput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    marginTop: 4,
    borderRadius: 6,
    backgroundColor: "#f5f3ff",
  },
  openOutputText: { fontSize: 12, fontWeight: "600", color: "#6d28d9" },
  detailMeta: { fontSize: 12, color: "#666666", lineHeight: 18 },
  detailMetaDark: { color: "#888888" },
  // Subagent entry point. Purple matches the swarm accent used on session
  // rows, so "this leads to another agent's work" reads consistently.
  subagentLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#f5f3ff",
    borderWidth: 1,
    borderColor: "#ddd6fe",
  },
  subagentLinkDark: { backgroundColor: "#2e1065", borderColor: "#4c1d95" },
  subagentLinkText: { fontSize: 12, fontWeight: "600", color: "#6d28d9" },
  subagentBadge: { backgroundColor: "#ede9fe", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  subagentBadgeText: { fontSize: 10, fontWeight: "600", color: "#6d28d9" },
  subagentModel: { flex: 1, textAlign: "right", fontSize: 10, color: "#666666" },

  // Code block
  codeBlock: {
    backgroundColor: "#f8f8f8",
    borderRadius: 6,
    padding: 10,
  },
  codeBlockDark: { backgroundColor: "#1a1a1a" },
  codePre: {
    fontSize: 12,
    fontFamily: mono,
    color: "#0a0a0a",
    lineHeight: 18,
  },
  codePteDark: { color: "#e5e5e5" },
  codePrompt: { color: "#8b5cf6", fontWeight: "700" },

  // Todo
  todoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  todoText: { fontSize: 13, color: "#0a0a0a", flex: 1, lineHeight: 20 },
  todoTextDark: { color: "#e5e5e5" },
  todoDone: { textDecorationLine: "line-through", color: "#999999" },
})
