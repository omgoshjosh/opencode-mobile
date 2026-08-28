import { useCallback, useMemo, useRef } from "react"
import { View, Text, ScrollView, StyleSheet, useColorScheme } from "react-native"
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSessions } from "../../src/stores/sessions"
import { ToolCallCard } from "../../src/components/chat"
import { summarizeToolRun } from "../../src/lib/tool-titles"
import { ownsToolRunTranscript } from "../../src/lib/tool-run-ownership"

/**
 * All tool calls of one message, as their own screen.
 *
 * The transcript shows each call as a bare link; this is where those links
 * land. With a `focus` param the linked call arrives already EXPANDED and
 * scrolled to the top of the page — the reader asked about that call, so it
 * should be the first thing under their thumb, not somewhere below the fold.
 *
 * Reads parts from the sessions store rather than carrying them in route
 * params: this screen is only reachable from the open session, whose parts
 * are live in the store — and staying live means a still-running call
 * updates here in real time.
 */
export default function ToolRunScreen() {
  const { messageID, focus, sessionID, directory } = useLocalSearchParams<{
    messageID: string
    focus?: string
    sessionID?: string
    directory?: string
  }>()
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()
  const scrollRef = useRef<ScrollView>(null)
  const didScroll = useRef(false)

  const currentSessionID = useSessions((s) => s.currentSession?.id)
  const selectSession = useSessions((s) => s.selectSession)
  const setTranscriptActive = useSessions((s) => s.setTranscriptActive)
  const refreshMessages = useSessions((s) => s.refreshMessages)
  const ownsTranscript = ownsToolRunTranscript(sessionID, currentSessionID)
  const parts = useSessions((s) => (ownsTranscript && messageID ? s.parts[messageID] : undefined))
  const toolParts = useMemo(() => (parts ?? []).filter((p) => p.type === "tool"), [parts])
  const summary = useMemo(() => summarizeToolRun(toolParts), [toolParts])
  // For calls whose state carries no start time: the owning message's
  // created time is the honest approximation.
  const messageCreated = useSessions(
    (s) => (ownsTranscript ? s.messages.find((m) => m.id === messageID)?.time?.created : undefined),
  )

  useFocusEffect(
    useCallback(() => {
      if (!sessionID) return
      const controller = new AbortController()
      selectSession(sessionID, directory, controller.signal).then((selected) => {
        if (controller.signal.aborted) return
        const isVisibleCache = useSessions.getState().currentSession?.id === sessionID
        if (!selected && !isVisibleCache) return
        setTranscriptActive(sessionID, true)
        void refreshMessages(controller.signal)
      })
      return () => {
        setTranscriptActive(sessionID, false)
        controller.abort()
      }
    }, [sessionID, directory, selectSession, setTranscriptActive, refreshMessages]),
  )

  return (
    <>
      <Stack.Screen
        options={{
          title: ownsTranscript
            ? `${summary.count} tool ${summary.count === 1 ? "call" : "calls"}${summary.failed ? ` · ${summary.failed} failed` : ""}`
            : "Tool calls",
        }}
      />
      <ScrollView
        ref={scrollRef}
        style={[s.container, isDark && s.containerDark]}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 4 }}
      >
        {!ownsTranscript || toolParts.length === 0 ? (
          <Text style={[s.empty, isDark && s.emptyDark]}>
            This message's tool calls are no longer loaded. Go back and reopen the session.
          </Text>
        ) : (
          toolParts.map((item) => (
            <View
              key={item.id}
              onLayout={(e) => {
                // Scroll once, as soon as the focused card knows where it
                // lives. Cards above it are collapsed at mount, so this y is
                // stable — no second pass needed.
                if (focus && item.id === focus && !didScroll.current) {
                  didScroll.current = true
                  const y = e.nativeEvent.layout.y
                  requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: true }))
                }
              }}
            >
              <ToolCallCard
                tool={item}
                isDark={isDark}
                initiallyExpanded={item.id === focus}
                fallbackStartTime={messageCreated}
              />
            </View>
          ))
        )}
      </ScrollView>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  empty: { fontSize: 14, color: "#666666", textAlign: "center", marginTop: 60, paddingHorizontal: 32 },
  emptyDark: { color: "#888888" },
})
