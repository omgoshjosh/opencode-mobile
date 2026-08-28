import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ActivityIndicator } from "react-native"
import { useTranslation } from "react-i18next"
import { useEvents } from "../../stores/events"
import { useSessions } from "../../stores/sessions"
import { quietLabel } from "../../lib/quiet-hint"

interface Props {
  sessionID: string
  isDark: boolean
  /** A tool call in the live message is still running (suppresses the quiet hint). */
  hasRunningTool?: boolean
}

export function StatusIndicator({ sessionID, isDark, hasRunningTool }: Props) {
  const { t } = useTranslation()
  const status = useEvents((s) => s.sessionStatus[sessionID])
  const text = useEvents((s) => s.statusText[sessionID])
  const optimistic = useSessions((s) => s.sending[sessionID])
  const lastActivityAt = useEvents((s) => {
    const status = s.sessionStatus[sessionID]
    return status?.type === "busy" ? status.lastActivityAt : undefined
  })

  // SSE status is the source of truth. The optimistic `sending` flag only
  // covers the gap between the user tapping send and SSE confirming busy.
  // Once SSE reports idle, the indicator hides regardless of the optimistic flag.
  const sseBusy = status && status.type !== "idle"
  const busy = sseBusy || (optimistic && !status)

  // A minute-granularity clock so the quiet hint advances while on screen.
  // Hooks stay above the early return; the ticker only runs while busy.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [busy])

  if (!busy) return null

  const label =
    status?.type === "retry" ? t("chat.statusIndicator.retrying", { attempt: status.attempt }) : text || t("chat.statusIndicator.working")
  // "Working…" that has gone silent is the stuck-vs-thinking question — the
  // server can hold a run open with nothing in it (observed live: 25 quiet
  // minutes of busy). Name the silence so a nudge is an informed decision.
  const quiet = quietLabel({ lastTextAt: lastActivityAt, hasRunningTool: Boolean(hasRunningTool), now })

  return (
    <View style={[s.bar, isDark && s.barDark]}>
      <ActivityIndicator size="small" color="#8b5cf6" />
      <Text style={[s.text, isDark && s.textDark]}>{label}</Text>
      {quiet && <Text style={[s.quiet, isDark && s.quietDark]}>· {quiet}</Text>}
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f5f3ff",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  barDark: { backgroundColor: "#1a1a2e", borderTopColor: "#2a2a2a" },
  text: { fontSize: 13, color: "#6d28d9", fontWeight: "500" },
  textDark: { color: "#a78bfa" },
  // Amber, matching the running-elapsed treatment: silence is a caution
  // signal, not an error.
  quiet: { fontSize: 12, color: "#b45309", fontWeight: "600" },
  quietDark: { color: "#fbbf24" },
})
