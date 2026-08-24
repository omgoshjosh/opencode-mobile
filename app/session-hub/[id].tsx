import { useEffect, useMemo, useState } from "react"
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useColorScheme } from "react-native"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSessions } from "../../src/stores/sessions"
import { useEvents } from "../../src/stores/events"
import { useCatalog } from "../../src/stores/catalog"
import { sessionStats, compactNumber } from "../../src/lib/session-stats"
import { getTranscript } from "../../src/lib/transcript-cache"
import { modelDisplayLabel, modelIDDisplayLabel } from "../../src/lib/model-label"
import { SWARM_PROVIDER_ID } from "../../src/lib/swarm-model"
import { indexByID, depthOf } from "../../src/lib/session-tree"
import { looksLikeCIWait, type RunningTool } from "../../src/lib/running-tools"
import { pendingWakeFor, wakeCountdownLabel } from "../../src/lib/pending-wakes"
import { formatElapsed } from "../../src/lib/elapsed-format"

/**
 * The session's own page: everything ABOUT the session, so the transcript can
 * stay about the conversation.
 *
 * This is where the depth-over-density philosophy lands for sessions — cost,
 * tokens, models that actually ran, and the subagent tree all live one tap
 * behind the header instead of crowding the transcript or an overlay.
 */
export default function SessionHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()

  const currentSession = useSessions((s) => s.currentSession)
  const messages = useSessions((s) => s.messages)
  const sessions = useSessions((s) => s.sessions)
  const previews = useSessions((s) => s.previews)
  const transcriptCache = useSessions((s) => s.transcriptCache)
  const providers = useCatalog((c) => c.providers)

  // Render from the ROUTE id, never from whichever session the store has
  // open: drilling from this hub into a subagent re-points currentSession,
  // so coming BACK here found id ≠ currentSession and the whole hub
  // degraded to its deep-link fallback, titled with the wrong session
  // (found on Pixel 8 Pro). The session record comes from the list; usage
  // comes from the live transcript when this session is the open one, else
  // from its parked copy in the transcript cache.
  const isCurrent = currentSession?.id === id
  const session = isCurrent ? currentSession : (sessions.find((x) => x.id === id) ?? null)
  const statsMessages = isCurrent ? messages : (getTranscript(transcriptCache, id ?? "")?.messages ?? null)
  const stats = useMemo(() => sessionStats(statsMessages ?? []), [statsMessages])

  const swarmLabel =
    session?.model?.providerID === SWARM_PROVIDER_ID
      ? modelDisplayLabel(providers, { providerID: SWARM_PROVIDER_ID, modelID: session.model.id })
      : null

  // Direct children only. Grandchildren are reachable by descending — showing
  // the whole tree flat here would recreate the overcrowding this screen
  // exists to avoid.
  const children = useMemo(() => {
    const byID = indexByID(sessions)
    return sessions.filter((s) => s.parentID === id).map((s) => ({ ...s, depth: depthOf(s, byID) }))
  }, [sessions, id])

  // WAITING ON — every in-flight tool call for this session and its direct
  // children, streamed live off the global SSE feed (src/lib/running-tools).
  // This answers "what exactly is the farm chewing on" without opening each
  // subagent; elapsed ticks so a hung call visibly ages.
  const runningTools = useSessions((s) => s.runningTools)
  const sessionStatus = useEvents((s) => s.sessionStatus)
  const waiting = useMemo(() => {
    const scope = [id, ...children.map((c) => c.id)].filter(Boolean) as string[]
    const titleFor = (sid: string) =>
      sid === id ? "this session" : (sessions.find((x) => x.id === sid)?.title ?? sid)
    return scope.flatMap((sid) => {
      const tracked = runningTools[sid] ?? []
      if (tracked.length > 0) return tracked.map((tool) => ({ tool, owner: titleFor(sid), sid }))
      // Enriched-status fallback (server contract, optional): the server can
      // name a running tool this client never saw start.
      const status = sessionStatus[sid]
      const serverTool = status?.type === "busy" ? status.runningTool : undefined
      if (serverTool?.title) {
        return [
          {
            tool: {
              partID: `status-${sid}`,
              messageID: "",
              sessionID: sid,
              title: serverTool.title,
              tool: "",
              startedAt: serverTool.startedAt ?? Date.now(),
            } satisfies RunningTool,
            owner: titleFor(sid),
            sid,
          },
        ]
      }
      return []
    })
  }, [runningTools, sessionStatus, id, children, sessions])
  // The OTHER wait mechanism: sessions that will receive a scheduled wake.
  // Same scope as the tool rows; client-derived until the server's
  // pendingWake field ships (see src/lib/pending-wakes.ts for the honesty
  // contract — these rows say "wakes in", never "running").
  const pendingWakes = useSessions((s) => s.pendingWakes)
  const [now, setNow] = useState(() => Date.now())
  const wakes = useMemo(() => {
    const scope = [id, ...children.map((c) => c.id)].filter(Boolean) as string[]
    const titleFor = (sid: string) =>
      sid === id ? "this session" : (sessions.find((x) => x.id === sid)?.title ?? sid)
    return scope.flatMap((sid) => {
      const wake = pendingWakeFor(pendingWakes, sid, now)
      return wake ? [{ wake, owner: titleFor(sid), sid }] : []
    })
  }, [pendingWakes, id, children, sessions, now])
  // 1s tick only while something is actually in flight or scheduled.
  useEffect(() => {
    if (waiting.length === 0 && wakes.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting.length > 0, wakes.length > 0])

  return (
    <>
      <Stack.Screen options={{ title: session?.title || "Session" }} />
      <ScrollView
        style={[s.container, isDark && s.containerDark]}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      >
        {!session ? (
          // A genuinely unknown id (stale deep link before any list load) —
          // degrade, don't lie.
          <Text style={[s.dim, s.center]}>Open the session first, then its hub.</Text>
        ) : (
          <>
            {swarmLabel && (
              <View style={s.swarmRow}>
                <Ionicons name="people" size={14} color="#6d28d9" />
                <Text style={s.swarmText}>{swarmLabel}</Text>
              </View>
            )}

            <Text style={[s.label, isDark && s.dim]}>USAGE</Text>
            {statsMessages === null ? (
              // No transcript in memory for this session — zeros here would
              // be fiction, not data.
              <Text style={[s.dim, { fontSize: 13 }]}>Open the session to load usage.</Text>
            ) : (
              <View style={[s.card, isDark && s.cardDark]}>
                <Stat label="Cost" value={`$${stats.cost.toFixed(2)}`} isDark={isDark} />
                <Stat label="Input" value={compactNumber(stats.inputTokens)} isDark={isDark} />
                <Stat label="Output" value={compactNumber(stats.outputTokens)} isDark={isDark} />
                <Stat label="Cache reads" value={compactNumber(stats.cacheReadTokens)} isDark={isDark} />
                <Stat
                  label="Messages"
                  value={`${stats.userMessages} you · ${stats.assistantMessages} assistant`}
                  isDark={isDark}
                />
              </View>
            )}

            {stats.models.length > 0 && (
              <>
                <Text style={[s.label, isDark && s.dim]}>MODELS THAT RAN</Text>
                <View style={s.chipWrap}>
                  {stats.models.map((modelID) => (
                    <View key={modelID} style={[s.chip, isDark && s.chipDark]}>
                      {/* Message records carry bare model ids; resolve to the
                          catalog's display name so a swarm shows its team
                          name, not its swm_ handle. */}
                      <Text style={s.chipText}>{modelIDDisplayLabel(providers, modelID)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {(waiting.length > 0 || wakes.length > 0) && (
              <>
                <Text style={[s.label, isDark && s.dim]}>WAITING ON ({waiting.length + wakes.length})</Text>
                {wakes.map(({ wake, owner, sid }) => (
                  <TouchableOpacity
                    key={`wake-${sid}`}
                    style={[s.waitRow, isDark && s.cardDark]}
                    onPress={() =>
                      sid !== id &&
                      router.push({
                        pathname: "/session/[id]",
                        params: { id: sid, ...(session?.directory ? { directory: session.directory } : {}) },
                      })
                    }
                    activeOpacity={sid === id ? 1 : 0.7}
                    testID={`wake-${sid}`}
                  >
                    <Ionicons name="alarm-outline" size={16} color="#8b5cf6" />
                    <View style={s.childText}>
                      <Text style={[s.childTitle, isDark && s.light]} numberOfLines={1}>
                        {wakeCountdownLabel(wake, now)}
                        {wake.reason ? ` — ${wake.reason}` : ""}
                      </Text>
                      <Text style={[s.childPreview, isDark && s.dim]} numberOfLines={1}>
                        {owner}
                      </Text>
                    </View>
                    <View style={s.wakeChip}>
                      <Text style={s.wakeChipText}>scheduled</Text>
                    </View>
                    {sid !== id && <Ionicons name="chevron-forward" size={16} color={isDark ? "#666" : "#999"} />}
                  </TouchableOpacity>
                ))}
                {waiting.map(({ tool, owner, sid }) => (
                  <TouchableOpacity
                    key={tool.partID}
                    style={[s.waitRow, isDark && s.cardDark]}
                    onPress={() =>
                      sid !== id &&
                      router.push({
                        pathname: "/session/[id]",
                        params: { id: sid, ...(session?.directory ? { directory: session.directory } : {}) },
                      })
                    }
                    activeOpacity={sid === id ? 1 : 0.7}
                    testID={`waiting-${tool.partID}`}
                  >
                    <Text style={[s.waitElapsed]}>{formatElapsed(Math.max(0, now - tool.startedAt))}</Text>
                    <View style={s.childText}>
                      <Text style={[s.childTitle, isDark && s.light]} numberOfLines={1}>
                        {tool.title}
                      </Text>
                      <Text style={[s.childPreview, isDark && s.dim]} numberOfLines={1}>
                        {owner}
                      </Text>
                    </View>
                    {/* Watchers are EXPECTED to be long-lived — labeling them
                        keeps a 20-minute monitor from reading like a 20-minute
                        problem. Workers get no chip; their age speaks. */}
                    {tool.tool === "monitor" && (
                      <View style={s.watchChip}>
                        <Text style={s.watchChipText}>watching</Text>
                      </View>
                    )}
                    {looksLikeCIWait(tool.title) && (
                      <View style={s.ciChip}>
                        <Text style={s.ciChipText}>CI</Text>
                      </View>
                    )}
                    {sid !== id && <Ionicons name="chevron-forward" size={16} color={isDark ? "#666" : "#999"} />}
                  </TouchableOpacity>
                ))}
              </>
            )}

            <Text style={[s.label, isDark && s.dim]}>
              SUBAGENTS{children.length > 0 ? ` (${children.length})` : ""}
            </Text>
            {children.length === 0 ? (
              <Text style={[s.dim, { fontSize: 13 }]}>None spawned by this session.</Text>
            ) : (
              children.map((child) => (
                <TouchableOpacity
                  key={child.id}
                  style={[s.childRow, isDark && s.cardDark]}
                  onPress={() =>
                    router.push({
                      pathname: "/session/[id]",
                      params: { id: child.id, ...(child.directory ? { directory: child.directory } : {}) },
                    })
                  }
                  testID={`hub-child-${child.id}`}
                >
                  <Ionicons name="git-branch-outline" size={14} color="#6d28d9" />
                  <View style={s.childText}>
                    <Text style={[s.childTitle, isDark && s.light]} numberOfLines={1}>
                      {child.title || "Untitled"}
                    </Text>
                    {previews[child.id]?.text && (
                      <Text style={[s.childPreview, isDark && s.dim]} numberOfLines={1}>
                        {previews[child.id].text}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={isDark ? "#666" : "#999"} />
                </TouchableOpacity>
              ))
            )}
          </>
        )}
      </ScrollView>
    </>
  )
}

function Stat({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View style={s.statRow}>
      <Text style={[s.statLabel, isDark && s.dim]}>{label}</Text>
      <Text style={[s.statValue, isDark && s.light]}>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  center: { textAlign: "center", marginTop: 60 },
  dim: { color: "#888888" },
  light: { color: "#ffffff" },
  label: { fontSize: 11, fontWeight: "700", color: "#888888", letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  swarmRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  swarmText: { fontSize: 13, fontWeight: "600", color: "#6d28d9" },
  card: { backgroundColor: "#fafafa", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  cardDark: { backgroundColor: "#141414" },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  statLabel: { fontSize: 13, color: "#666666" },
  statValue: { fontSize: 13, fontWeight: "600", color: "#0a0a0a" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "#ede9fe", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  chipDark: { backgroundColor: "#2e1065" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#6d28d9" },
  childRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  childText: { flex: 1, gap: 1 },
  // Waiting-on rows: elapsed leads — the age of a wait is the datum.
  waitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  waitElapsed: { fontSize: 13, fontWeight: "700", color: "#f59e0b", fontVariant: ["tabular-nums"], minWidth: 44 },
  ciChip: { backgroundColor: "#dbeafe", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  ciChipText: { fontSize: 10, fontWeight: "700", color: "#1d4ed8" },
  watchChip: { backgroundColor: "#fef3c7", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  watchChipText: { fontSize: 10, fontWeight: "700", color: "#92400e" },
  wakeChip: { backgroundColor: "#ede9fe", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  wakeChipText: { fontSize: 10, fontWeight: "700", color: "#6d28d9" },
  childTitle: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
  childPreview: { fontSize: 12, color: "#888888" },
})
