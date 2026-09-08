import { useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList } from "@gorhom/bottom-sheet"
import { formatElapsed, LIVE_TICK_MS } from "../../lib/elapsed-format"
import { QuestionPrompt } from "./QuestionPrompt"
import type { BackgroundJob } from "../../lib/background-activity"
import type { Session } from "../../lib/sdk"
import { workerStateColors, workerStateLabel, workerStateSections, type WorkerState } from "../../lib/worker-states"

export type StatefulJob = BackgroundJob & { state: WorkerState }

interface PendingQuestion {
  id: string
  sessionID: string
  questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiple?: boolean; custom?: boolean }>
}

type Row =
  | { kind: "header"; key: string; title: string; count: number; state: WorkerState }
  | { kind: "job"; key: string; job: StatefulJob; question?: PendingQuestion }

const SECTION_TITLES: Record<WorkerState, string> = {
  "awaiting-answer": "Needs input",
  failed: "Failed",
  stalled: "Stalled",
  working: "Working",
  queued: "Queued",
  ended: "No longer running",
}

export function BackgroundJobsSheet({
  sheetRef,
  jobs,
  endedJobs = [],
  sessions = [],
  questionsBySession = {},
  isDark,
  onOpen,
  onReplyQuestion,
  onRejectQuestion,
}: {
  sheetRef: React.RefObject<BottomSheet | null>
  jobs: StatefulJob[]
  endedJobs?: readonly BackgroundJob[]
  sessions?: Session[]
  questionsBySession?: Record<string, PendingQuestion[] | undefined>
  isDark: boolean
  onOpen: (job: BackgroundJob) => void
  onReplyQuestion?: (sessionID: string, requestID: string, answers: string[][]) => void
  onRejectQuestion?: (sessionID: string, requestID: string) => void
}) {
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  const [answering, setAnswering] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), LIVE_TICK_MS)
    return () => clearInterval(timer)
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const sections = workerStateSections(jobs)
    // "No longer running" is client-observed: these jobs left `jobs[]`, which
    // is ambiguous (finished, OR the daemon restarted, OR a decode failed), so
    // the section never claims success, an outcome, or a completion time.
    if (endedJobs.length) sections.push({ state: "ended", jobs: endedJobs.map((job) => ({ ...job, state: "ended" as WorkerState })) })
    return sections.flatMap((section) => [
      { kind: "header" as const, key: `header-${section.state}`, title: SECTION_TITLES[section.state], count: section.jobs.length, state: section.state },
      ...section.jobs.map((job) => ({
        kind: "job" as const,
        key: `${section.state}-${job.sessionID}`,
        job,
        question: section.state === "awaiting-answer" ? questionsBySession[job.sessionID]?.[0] : undefined,
      })),
    ])
  }, [jobs, endedJobs, questionsBySession])

  const meta = (job: StatefulJob) => {
    const parentID = sessions.find((session) => session.id === job.sessionID)?.parentID
    const parentTitle = parentID ? sessions.find((session) => session.id === parentID)?.title : undefined
    // Elapsed only when there is a real timestamp. `session.status.background`
    // carries no `since`, so for most jobs there is nothing to count from and
    // inventing one would be a number the server never said.
    const elapsed = job.since > 0 ? formatElapsed(Math.max(0, now - job.since)) : null
    return [job.role, parentTitle ? `under ${parentTitle}` : null, elapsed].filter(Boolean).join(" · ")
  }

  return <BottomSheet ref={sheetRef} index={-1} onChange={(index) => { setOpen(index >= 0); if (index < 0) setAnswering(null) }} snapPoints={["45%", "90%"]} enableDynamicSizing={false} enablePanDownToClose backgroundStyle={isDark ? s.dark : s.sheet} backdropComponent={(props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />}>
    <Text style={[s.title, isDark && s.white]}>Workers</Text>
    <BottomSheetFlatList
      data={rows}
      keyExtractor={(row: Row) => row.key}
      renderItem={({ item }: { item: Row }) => {
        if (item.kind === "header") {
          return <View style={s.sectionHeader}>
            <View style={[s.dot, { backgroundColor: workerStateColors(item.state).background }]} />
            <Text style={[s.sectionTitle, isDark && s.dim]}>{`${item.title} · ${item.count}`}</Text>
          </View>
        }
        const { job, question } = item
        const expanded = question && answering === question.id
        return <View style={s.row}>
          <TouchableOpacity onPress={() => onOpen(job)} accessibilityRole="button" accessibilityLabel={`${job.title}, ${meta(job)}, ${workerStateLabel(job.state, 1)}`}>
            <Text style={[s.job, isDark && s.white]} numberOfLines={1}>{job.title}</Text>
            <Text style={[s.meta, isDark && s.dim]} numberOfLines={1}>{meta(job)}</Text>
          </TouchableOpacity>
          {question && !expanded && <View style={s.question}>
            <Text style={[s.questionHeader, isDark && s.white]} numberOfLines={1}>{question.questions[0]?.header || "Input needed"}</Text>
            <Text style={[s.questionText, isDark && s.dim]} numberOfLines={2}>{question.questions[0]?.question}</Text>
            <Text style={[s.asked, isDark && s.dim]}>{`asked by ${job.role}`}</Text>
            {question.questions[0]?.options?.length ? <Text style={[s.options, isDark && s.dim]} numberOfLines={2}>{question.questions[0].options.map((option) => option.label).join(" · ")}</Text> : null}
            <View style={s.actions}>
              <TouchableOpacity style={s.answer} onPress={() => { setAnswering(question.id); sheetRef.current?.snapToIndex(1) }} accessibilityRole="button" accessibilityLabel={`Answer ${job.title}`}>
                <Text style={s.answerText}>Answer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.reject} onPress={() => onRejectQuestion?.(question.sessionID, question.id)} accessibilityRole="button" accessibilityLabel={`Reject ${job.title}`}>
                <Text style={[s.rejectText, isDark && s.dim]}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>}
          {question && expanded && <QuestionPrompt
            request={question}
            isDark={isDark}
            onReply={(answers) => { setAnswering(null); onReplyQuestion?.(question.sessionID, question.id, answers) }}
            onReject={() => { setAnswering(null); onRejectQuestion?.(question.sessionID, question.id) }}
          />}
        </View>
      }}
      ListEmptyComponent={<Text style={[s.meta, s.empty, isDark && s.dim]}>No workers running.</Text>}
    />
  </BottomSheet>
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#fff" },
  dark: { backgroundColor: "#141420" },
  title: { fontSize: 17, fontWeight: "700", color: "#0a0a0a", padding: 20 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#666", textTransform: "uppercase", letterSpacing: 0.5 },
  row: { minHeight: 56, paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#e5e5e5", justifyContent: "center", gap: 3 },
  job: { fontSize: 15, fontWeight: "600", color: "#0a0a0a" },
  meta: { fontSize: 12, color: "#666" },
  empty: { padding: 20 },
  question: { marginTop: 8, gap: 3 },
  questionHeader: { fontSize: 13, fontWeight: "700", color: "#0a0a0a" },
  questionText: { fontSize: 13, lineHeight: 18, color: "#444" },
  asked: { fontSize: 11, color: "#888" },
  options: { fontSize: 11, color: "#888" },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  answer: { minHeight: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#dc2626" },
  answerText: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
  reject: { minHeight: 36, justifyContent: "center", paddingHorizontal: 8 },
  rejectText: { color: "#666", fontSize: 13, fontWeight: "600" },
  white: { color: "#fff" },
  dim: { color: "#aaa" },
})
