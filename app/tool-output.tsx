import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useColorScheme, Platform, Linking, Alert } from "react-native"
import { Stack } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import * as Clipboard from "expo-clipboard"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useViewer } from "../src/stores/viewer"
import { extractLinks } from "../src/lib/link-extract"
import { canApplyToolOutput, matchingToolPart } from "../src/lib/tool-output"
import { useConnections } from "../src/stores/connections"

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

/**
 * Full-screen viewer for one tool call's output.
 *
 * Raw output stays raw: mono, selectable, unstyled — bash output was never
 * meant to carry formatting, so it is not linkified or marked up in place.
 * URLs found in it are offered separately as chips (tap opens, long-press
 * copies), which keeps the text authentic while making links usable.
 */
export default function ToolOutputScreen() {
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()
  const payload = useViewer((s) => s.toolOutput)
  const [copied, setCopied] = useState(false)
  const [output, setOutput] = useState(payload?.output ?? "")
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle")

  useEffect(() => {
    setOutput(payload?.output ?? "")
    setLoadState("idle")
    if (!payload?.truncated || !payload.sessionID || !payload.messageID) return
    const connections = useConnections.getState()
    const client = payload.directory
      ? connections.clientForDirectory(payload.directory) ?? (connections.clientBase ? null : connections.client)
      : connections.client
    if (!client) return
    const controller = new AbortController()
    setLoadState("loading")
    client.session.message(payload.sessionID, payload.messageID, controller.signal)
      .then((message) => {
        const part = matchingToolPart(message.parts, payload)
        if (typeof part?.state?.output !== "string") throw new Error("Matching tool output was not returned")
        if (canApplyToolOutput(payload, useViewer.getState().toolOutput, controller.signal.aborted)) {
          setOutput(part.state.output)
          setLoadState("idle")
        }
      })
      .catch(() => {
        if (canApplyToolOutput(payload, useViewer.getState().toolOutput, controller.signal.aborted)) setLoadState("error")
      })
    return () => controller.abort()
  }, [payload])

  const links = useMemo(() => extractLinks(output), [output])

  const copyAll = useCallback(async () => {
    if (!payload) return
    await Clipboard.setStringAsync(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [payload, output])

  const copyLink = useCallback(async (url: string) => {
    await Clipboard.setStringAsync(url)
    Alert.alert("Copied", url)
  }, [])

  return (
    <>
      <Stack.Screen
        options={{
          title: payload?.title ?? "Tool output",
          headerRight: () => (
            <TouchableOpacity onPress={copyAll} hitSlop={8} testID="copy-output">
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={20} color={copied ? "#22c55e" : "#8b5cf6"} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={[s.container, isDark && s.containerDark]}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      >
        {!payload ? (
          <Text style={[s.empty, isDark && s.textDim]}>Nothing to show — open this from a tool call.</Text>
        ) : (
          <>
            {payload.input && (
              <>
                <Text style={[s.label, isDark && s.textDim]}>INPUT</Text>
                <View style={[s.block, isDark && s.blockDark]}>
                  <Text style={[s.mono, isDark && s.monoDark]} selectable>
                    {payload.input}
                  </Text>
                </View>
              </>
            )}

            {links.length > 0 && (
              <>
                <Text style={[s.label, isDark && s.textDim]}>LINKS</Text>
                <View style={s.linkWrap}>
                  {links.map((url) => (
                    <TouchableOpacity
                      key={url}
                      style={[s.linkChip, isDark && s.linkChipDark]}
                      onPress={() => Linking.openURL(url).catch(() => copyLink(url))}
                      onLongPress={() => copyLink(url)}
                      testID={`link-${url}`}
                    >
                      <Ionicons name="link-outline" size={12} color="#6d28d9" />
                      <Text style={s.linkText} numberOfLines={1}>
                        {url}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={[s.label, isDark && s.textDim]}>OUTPUT</Text>
            {loadState === "loading" && <Text style={[s.status, isDark && s.textDim]}>Loading complete output...</Text>}
            {loadState === "error" && <Text style={s.error}>Complete output unavailable; showing the captured output.</Text>}
            <View style={[s.block, isDark && s.blockDark]}>
              <Text style={[s.mono, isDark && s.monoDark]} selectable testID="tool-output-text">
                {output}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  empty: { fontSize: 14, color: "#666666", textAlign: "center", marginTop: 60 },
  label: { fontSize: 11, fontWeight: "700", color: "#888888", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  textDim: { color: "#777777" },
  block: { backgroundColor: "#f5f5f5", borderRadius: 8, padding: 12 },
  blockDark: { backgroundColor: "#161616" },
  mono: { fontFamily: mono, fontSize: 12, lineHeight: 18, color: "#1a1a1a" },
  monoDark: { color: "#d4d4d4" },
  linkWrap: { gap: 6 },
  linkChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f5f3ff",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  linkChipDark: { backgroundColor: "#2e1065" },
  linkText: { fontSize: 12, color: "#6d28d9", flexShrink: 1 },
  status: { fontSize: 12, color: "#666666", marginBottom: 6 },
  error: { fontSize: 12, color: "#dc2626", marginBottom: 6 },
})
