import { useState, useCallback, useEffect } from "react"
import { LIVE_TICK_MS, formatElapsed } from "../../lib/elapsed-format"
import { resolveClockMode, shorthandTimestamp } from "../../lib/timestamp-shorthand"
import { deviceUses24hClock } from "../../lib/device-clock"
import { useSettings } from "../../stores/settings"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Platform, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { router } from "expo-router"
import type { Part } from "../../lib/sdk"
import { DiffView } from "./DiffView"
import { isSubagentOpenable, subagentBadge, subagentLinkFrom } from "../../lib/subagent-link"
import { toolCallTitle } from "../../lib/tool-titles"
import { modelIDDisplayLabel } from "../../lib/model-label"
import { useViewer } from "../../stores/viewer"
import { useSessions } from "../../stores/sessions"
import { useCatalog } from "../../stores/catalog"

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
  sendmessage: "paper-plane-outline",
  skill: "sparkles-outline",
  graph_plan: "git-network-outline",
  graph_status: "git-network-outline",
  agent: "person-circle-outline",
  monitor: "pulse-outline",
  taskcreate: "add-circle-outline",
  taskupdate: "checkmark-done-outline",
  taskstop: "stop-circle-outline",
  schedulewakeup: "alarm-outline",
  opencodex_swarm_create: "people-circle-outline",
  browser_navigate: "compass-outline",
  toolsearch: "search-outline",
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
        // A write is "everything below is new" — render it in the same diff
        // vocabulary as edit (all-adds, green gutter) instead of a bare code
        // block, so edit and write read as the same kind of event.
        // computeDiff self-caps on large inputs (see diff-compute.ts).
        <DiffView before="" after={content} isDark={isDark} />
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
        // Tappable, not just legible: the point of seeing what the agent
        // fetched is being able to look at the same page yourself.
        <TouchableOpacity
          style={s.urlRow}
          onPress={() => Linking.openURL(url).catch(() => {})}
          activeOpacity={0.7}
          testID="webfetch-open-url"
        >
          <Text style={[s.detailFile, isDark && s.detailFileDark, { color: "#8b5cf6", flex: 1 }]} numberOfLines={3}>
            {url}
          </Text>
          <Ionicons name="open-outline" size={14} color="#8b5cf6" />
        </TouchableOpacity>
      )}
    </View>
  )
}

/**
 * The drill-in row for a task's spawned session.
 *
 * PINNED ABOVE the card's inner scroll (not rendered inside TaskDetail's
 * flow) — reported on device: with a long prompt below it, the banner
 * scrolled out of reach inside the 300px nested ScrollView, and nested
 * scroll-up inside the inverted transcript list would not give it back.
 * The drill-in is the card's whole point; it must not be scrollable away.
 */
function SubagentBanner({
  link,
  directory,
  isDark,
}: {
  link: NonNullable<ReturnType<typeof subagentLinkFrom>>
  directory?: string
  isDark: boolean
}) {
  const badge = subagentBadge(link)
  const providers = useCatalog((c) => c.providers)
  return (
    <TouchableOpacity
      style={[s.subagentLink, isDark && s.subagentLinkDark]}
      onPress={() =>
        router.push({
          pathname: "/session/[id]",
          // The child runs in the parent's directory; passing it keeps the
          // child screen on the same connection instead of falling back to
          // the active one, which may point elsewhere.
          params: { id: link.sessionID, ...(directory ? { directory } : {}) },
        })
      }
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
      {/* The swarm facade hides which model actually ran; this is the only
          place it surfaces. Resolve to the catalog's display name — the raw
          id was the last swm_/model handle still visible in a transcript. */}
      {link.modelID && (
        <Text style={[s.subagentModel, isDark && s.detailMetaDark]} numberOfLines={1}>
          {modelIDDisplayLabel(providers, link.modelID)}
        </Text>
      )}
      <Ionicons name="chevron-forward" size={14} color="#8b5cf6" />
    </TouchableOpacity>
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
  const directory = useSessions((st) => st.currentSession?.directory)

  return (
    <View style={s.detailSection}>
      {typeof description === "string" && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{description}</Text>}

      {/* The drill-in banner is pinned above this scroll area by the card —
          see SubagentBanner for why it must never live in here. */}
      {Boolean(link && !isSubagentOpenable(link)) && (
        <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>Subagent session no longer available.</Text>
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

function SendMessageDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const to = typeof rec?.to === "string" ? rec.to : undefined
  const message = typeof rec?.message === "string" ? rec.message : undefined
  return (
    <View style={s.detailSection}>
      {/* Agent-to-agent mail: WHO it went to is the headline, the body is
          prose (it's written by one agent for another, not machine output). */}
      {to && (
        <View style={s.toChipRow}>
          <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>To:</Text>
          <View style={s.toChip}>
            <Text style={s.toChipText} numberOfLines={1}>
              {to}
            </Text>
          </View>
        </View>
      )}
      {message && (
        <Text style={[s.proseBody, isDark && s.proseBodyDark]} selectable>
          {message}
        </Text>
      )}
    </View>
  )
}

function SkillDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  // Two shapes in the wild: {name} (OpencodeX roles) and {skill, args}
  // (Claude harness) — accept both.
  const name = typeof rec?.name === "string" ? rec.name : typeof rec?.skill === "string" ? rec.skill : undefined
  const args = typeof rec?.args === "string" ? rec.args : undefined
  const out = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {name && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={1}>
          {name}
        </Text>
      )}
      {args && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{args}</Text>}
      {out && out.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
            {out}
          </Text>
        </View>
      )}
    </View>
  )
}

function GraphPlanDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const goal = typeof rec?.goal === "string" ? rec.goal : undefined
  const criteria = Array.isArray(rec?.successCriteria)
    ? (rec.successCriteria as unknown[]).filter((c): c is string => typeof c === "string")
    : []
  return (
    <View style={s.detailSection}>
      {goal && (
        <Text style={[s.proseBody, isDark && s.proseBodyDark]} selectable>
          {goal}
        </Text>
      )}
      {criteria.map((criterion, index) => (
        <View key={index} style={s.todoRow}>
          <Ionicons name="flag-outline" size={14} color="#8b5cf6" />
          <Text style={[s.todoText, isDark && s.todoTextDark]} numberOfLines={3}>
            {criterion}
          </Text>
        </View>
      ))}
    </View>
  )
}

function AgentDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const description = typeof rec?.description === "string" ? rec.description : undefined
  const subagentType = typeof rec?.subagent_type === "string" ? rec.subagent_type : undefined
  const model = typeof rec?.model === "string" ? rec.model : undefined
  const prompt = typeof rec?.prompt === "string" ? rec.prompt : undefined
  return (
    <View style={s.detailSection}>
      {description && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{description}</Text>}
      {(subagentType || model) && (
        <View style={s.toChipRow}>
          {subagentType && (
            <View style={s.toChip}>
              <Text style={s.toChipText}>{subagentType}</Text>
            </View>
          )}
          {model && (
            <View style={s.toChip}>
              <Text style={s.toChipText}>{model}</Text>
            </View>
          )}
        </View>
      )}
      {prompt && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={20}>
            {prompt}
          </Text>
        </View>
      )}
    </View>
  )
}

function QuestionDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const questions = Array.isArray(rec?.questions) ? (rec.questions as Record<string, unknown>[]) : []
  return (
    <View style={s.detailSection}>
      {questions.map((q, i) => {
        const options = Array.isArray(q?.options) ? (q.options as Record<string, unknown>[]) : []
        return (
          <View key={i} style={{ gap: 3 }}>
            {typeof q?.question === "string" && (
              <Text style={[s.proseBody, isDark && s.proseBodyDark]} selectable>
                {q.question}
              </Text>
            )}
            {options.map((option, j) =>
              typeof option?.label === "string" ? (
                <View key={j} style={s.todoRow}>
                  <Ionicons name="ellipse-outline" size={12} color="#8b5cf6" />
                  <Text style={[s.todoText, isDark && s.todoTextDark]} numberOfLines={2}>
                    {option.label}
                  </Text>
                </View>
              ) : null,
            )}
          </View>
        )
      })}
    </View>
  )
}

function TaskListDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const subject = typeof rec?.subject === "string" ? rec.subject : undefined
  const description = typeof rec?.description === "string" ? rec.description : undefined
  const taskID = typeof rec?.taskId === "string" ? rec.taskId : undefined
  const status = typeof rec?.status === "string" ? rec.status : undefined
  return (
    <View style={s.detailSection}>
      {subject && (
        <Text style={[s.proseBody, isDark && s.proseBodyDark]} selectable>
          {subject}
        </Text>
      )}
      {(taskID || status) && (
        <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>
          {taskID ? `#${taskID}` : ""}
          {taskID && status ? " → " : ""}
          {status ?? ""}
        </Text>
      )}
      {description && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{description}</Text>}
    </View>
  )
}

function WakeupDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const stop = rec?.stop === true
  const delay = typeof rec?.delaySeconds === "number" ? rec.delaySeconds : undefined
  const reason = typeof rec?.reason === "string" ? rec.reason : undefined
  return (
    <View style={s.detailSection}>
      <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>
        {stop ? "Loop stopped." : delay !== undefined ? `Wakes in ${formatElapsed(delay * 1000)}` : "Wakeup"}
      </Text>
      {reason && (
        <Text style={[s.proseBody, isDark && s.proseBodyDark]} selectable>
          {reason}
        </Text>
      )}
    </View>
  )
}

function SwarmCreateDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const rec = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
  const prompt = typeof rec?.prompt === "string" ? rec.prompt : undefined
  return (
    <View style={s.detailSection}>
      {prompt && (
        <Text style={[s.proseBody, isDark && s.proseBodyDark]} selectable>
          {prompt}
        </Text>
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

// --- Renderer registry ---
//
// The interface for tool-specific rendering: one function per tool name,
// all taking the same props. Adding a tool = one detail function + one
// entry here (+ optionally an icon in TOOL_ICONS and a title case in
// tool-titles.ts). Unknown tools fall to GenericDetail — the JSON dump is
// the floor, never a crash. Deliberately NOT a plugin system: a flat map
// in the one file that uses it is all the abstraction this needs.
interface ToolDetailProps {
  tool: Part
  input: unknown
  output: unknown
  isDark: boolean
}

const TOOL_DETAILS: Record<string, (props: ToolDetailProps) => React.ReactElement | null> = {
  bash: ({ input, output, isDark }) => <BashDetail input={input} output={output} isDark={isDark} />,
  monitor: ({ input, output, isDark }) => <BashDetail input={input} output={output} isDark={isDark} />,
  read: ({ input, isDark }) => <ReadDetail input={input} isDark={isDark} />,
  write: ({ input, isDark }) => <WriteDetail input={input} isDark={isDark} />,
  edit: ({ input, output, isDark }) => <EditDetail input={input} output={output} isDark={isDark} />,
  apply_patch: ({ input, isDark }) => <PatchDetail input={input} isDark={isDark} />,
  glob: ({ input, output, isDark }) => <GlobGrepDetail input={input} output={output} isDark={isDark} />,
  grep: ({ input, output, isDark }) => <GlobGrepDetail input={input} output={output} isDark={isDark} />,
  list: ({ input, output, isDark }) => <GlobGrepDetail input={input} output={output} isDark={isDark} />,
  codesearch: ({ input, output, isDark }) => <GlobGrepDetail input={input} output={output} isDark={isDark} />,
  toolsearch: ({ input, output, isDark }) => <GlobGrepDetail input={input} output={output} isDark={isDark} />,
  webfetch: ({ input, isDark }) => <WebfetchDetail input={input} isDark={isDark} />,
  websearch: ({ input, isDark }) => <WebfetchDetail input={input} isDark={isDark} />,
  browser_navigate: ({ input, isDark }) => <WebfetchDetail input={input} isDark={isDark} />,
  task: ({ tool, isDark }) => <TaskDetail tool={tool} isDark={isDark} />,
  agent: ({ input, isDark }) => <AgentDetail input={input} isDark={isDark} />,
  sendmessage: ({ input, isDark }) => <SendMessageDetail input={input} isDark={isDark} />,
  skill: ({ input, output, isDark }) => <SkillDetail input={input} output={output} isDark={isDark} />,
  graph_plan: ({ input, isDark }) => <GraphPlanDetail input={input} isDark={isDark} />,
  question: ({ input, isDark }) => <QuestionDetail input={input} isDark={isDark} />,
  taskcreate: ({ input, isDark }) => <TaskListDetail input={input} isDark={isDark} />,
  taskupdate: ({ input, isDark }) => <TaskListDetail input={input} isDark={isDark} />,
  schedulewakeup: ({ input, isDark }) => <WakeupDetail input={input} isDark={isDark} />,
  opencodex_swarm_create: ({ input, isDark }) => <SwarmCreateDetail input={input} isDark={isDark} />,
  todowrite: ({ input, isDark }) => <TodoDetail input={input} isDark={isDark} />,
}

function ToolDetail({ tool, isDark }: { tool: Part; isDark: boolean }) {
  const render = (tool.tool && TOOL_DETAILS[tool.tool]) || undefined
  const props: ToolDetailProps = { tool, input: tool.state?.input, output: tool.state?.output, isDark }
  if (render) return render(props)
  return <GenericDetail input={props.input} output={props.output} isDark={isDark} />
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
  /**
   * When the call's own start time is missing, the owning MESSAGE's created
   * time is the honest approximation — supplied by screens that know it.
   */
  fallbackStartTime?: number
}

export function ToolCallCard({ tool, isDark, initiallyExpanded, fallbackStartTime }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(initiallyExpanded ?? false)
  const icon = (tool.tool && TOOL_ICONS[tool.tool]) || "extension-puzzle-outline"
  // A task with no explicit description used to sit on the bare floor
  // ("task") while the spawned session carried a real, server-generated
  // name everywhere else. The card already knows the child's sessionID
  // (the Watch-subagent link) — use its title. An explicit description
  // still wins: the orchestrator wrote it for exactly this purpose.
  const taskLink = tool.tool === "task" ? subagentLinkFrom(tool) : null
  const directory = useSessions((st) => st.currentSession?.directory)
  const spawnedTitle = useSessions((st) =>
    taskLink ? st.sessions.find((x) => x.id === taskLink.sessionID)?.title : undefined,
  )
  const taskInput = tool.tool === "task" ? (tool.state?.input as Record<string, unknown> | undefined) : undefined
  const hasExplicitName =
    typeof taskInput?.description === "string" || typeof taskInput?.summary === "string"
  const cardTitle =
    tool.tool === "task" && !hasExplicitName && spawnedTitle?.trim()
      ? spawnedTitle
      : toolCallTitle(tool)
  const status = tool.state?.status || "pending"
  const color = statusColor(status)
  const error = tool.state?.error?.message
  const isRunning = status === "running" || status === "pending"
  const elapsed = useElapsed(tool.state?.time?.start, tool.state?.time?.end, isRunning)
  // WHEN the call started, in the user's chosen zone. The call's own clock
  // wins; the owning message's created time is the fallback.
  const timeZone = useSettings((st) => st.timeZone)
  const clockMode = resolveClockMode(
    useSettings((st) => st.clock),
    deviceUses24hClock(),
  )
  const calledAt = shorthandTimestamp(tool.state?.time?.start ?? fallbackStartTime, Date.now(), timeZone, clockMode)
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
            {cardTitle || t("chat.toolCallCard.fallbackTitle")}
          </Text>
          {calledAt && <Text style={[s.elapsed, isDark && s.elapsedDark]}>{calledAt}</Text>}
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

      {/* Expanded detail. For tasks, the drill-in banner is pinned ABOVE the
          scroll — inside the ScrollView a long prompt pushed it out of reach
          and nested scroll-up in the inverted list would not return it
          (reported on device). */}
      {expanded && (
        <>
          {taskLink && isSubagentOpenable(taskLink) && (
            <SubagentBanner link={taskLink} directory={directory} isDark={isDark} />
          )}
          <ScrollView style={s.detailScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {error && <ErrorBanner message={error} isDark={isDark} />}
            <ToolDetail tool={tool} isDark={isDark} />
          </ScrollView>
        </>
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
  urlRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  // sendmessage
  toChipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toChip: { backgroundColor: "#ede9fe", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 },
  toChipText: { fontSize: 11, fontWeight: "600", color: "#6d28d9" },
  proseBody: { fontSize: 13, color: "#0a0a0a", lineHeight: 19, marginTop: 4 },
  proseBodyDark: { color: "#e5e5e5" },
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
