import { useMemo } from "react"
import { View, Text, FlatList, StyleSheet, useColorScheme } from "react-native"
import { Stack, useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSessions } from "../../src/stores/sessions"
import { ToolCallCard } from "../../src/components/chat"
import { summarizeToolRun } from "../../src/lib/tool-titles"

/**
 * All tool calls of one message, as their own screen.
 *
 * In the transcript a long run collapses to a single summary row; this is
 * where that row leads. Each call renders as the same expandable card used
 * inline, so behaviour is identical one level deeper — including the
 * open-full-output affordance for long results.
 *
 * Reads parts from the sessions store rather than carrying them in route
 * params: this screen is only reachable from the open session, whose parts
 * are live in the store — and staying live means a still-running call
 * updates here in real time.
 */
export default function ToolRunScreen() {
  const { messageID } = useLocalSearchParams<{ messageID: string }>()
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()

  const parts = useSessions((s) => (messageID ? s.parts[messageID] : undefined))
  const toolParts = useMemo(() => (parts ?? []).filter((p) => p.type === "tool"), [parts])
  const summary = useMemo(() => summarizeToolRun(toolParts), [toolParts])

  return (
    <>
      <Stack.Screen
        options={{
          title: `${summary.count} tool ${summary.count === 1 ? "call" : "calls"}${summary.failed ? ` · ${summary.failed} failed` : ""}`,
        }}
      />
      <FlatList
        style={[s.container, isDark && s.containerDark]}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 4 }}
        data={toolParts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ToolCallCard tool={item} isDark={isDark} />}
        ListEmptyComponent={
          <Text style={[s.empty, isDark && s.emptyDark]}>
            This message's tool calls are no longer loaded. Go back and reopen the session.
          </Text>
        }
      />
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  empty: { fontSize: 14, color: "#666666", textAlign: "center", marginTop: 60, paddingHorizontal: 32 },
  emptyDark: { color: "#888888" },
})
