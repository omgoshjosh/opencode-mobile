import { useEffect, useMemo } from "react"
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useColorScheme } from "react-native"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSwarms } from "../../../src/stores/swarms"
import { useSessions } from "../../../src/stores/sessions"
import { useCatalog } from "../../../src/stores/catalog"
import { modelDisplayLabel } from "../../../src/lib/model-label"
import { SWARM_PROVIDER_ID } from "../../../src/lib/swarm-model"

/**
 * A swarm's home: what the team IS and what it has been DOING.
 *
 * The list used to jump straight into the editor, which answers the rare
 * question (change the roster) while skipping the daily one (what has this
 * team run lately). Editing now lives one tap deeper, behind Edit.
 */
export default function SwarmHomeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()

  const swarms = useSwarms((s) => s.swarms)
  const load = useSwarms((s) => s.load)
  const sessions = useSessions((s) => s.sessions)
  const previews = useSessions((s) => s.previews)
  const providers = useCatalog((c) => c.providers)

  useEffect(() => {
    if (swarms.length === 0) load()
  }, [swarms.length, load])

  const swarm = useMemo(() => swarms.find((s) => s.id === id), [swarms, id])

  // Sessions whose model IS this swarm — the facade id makes this exact.
  const recent = useMemo(
    () =>
      sessions
        .filter((s) => s.model?.providerID === SWARM_PROVIDER_ID && s.model.id === id)
        .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
        .slice(0, 10),
    [sessions, id],
  )

  return (
    <>
      <Stack.Screen
        options={{
          title: swarm?.title ?? "Swarm",
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/swarms/[id]", params: { id: id! } })}
              hitSlop={8}
              testID="edit-swarm"
            >
              <Text style={s.editAction}>Edit</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={[s.container, isDark && s.containerDark]}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      >
        {!swarm ? (
          <Text style={[s.dim, s.center]}>Loading swarm…</Text>
        ) : (
          <>
            <Text style={[s.label, isDark && s.dim]}>TEAM ({swarm.roles.length})</Text>
            {swarm.roles.map((role) => (
              <View key={role.id ?? role.name} style={[s.roleRow, isDark && s.cardDark]}>
                <View style={s.roleText}>
                  <Text style={[s.roleName, isDark && s.light]} numberOfLines={1}>
                    {role.name}
                  </Text>
                  <View style={s.roleMeta}>
                    {role.skill && (
                      <View style={s.skillChip}>
                        <Text style={s.skillChipText}>{role.skill}</Text>
                      </View>
                    )}
                    {role.modelID && (
                      <Text style={[s.modelText, isDark && s.dim]} numberOfLines={1}>
                        {modelDisplayLabel(providers, { providerID: role.providerID ?? "", modelID: role.modelID })}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))}

            <Text style={[s.label, isDark && s.dim]}>
              RECENT SESSIONS{recent.length > 0 ? ` (${recent.length})` : ""}
            </Text>
            {recent.length === 0 ? (
              <Text style={[s.dim, { fontSize: 13 }]}>
                Nothing yet. Pick this swarm as the model in any session to put it to work.
              </Text>
            ) : (
              recent.map((session) => (
                <TouchableOpacity
                  key={session.id}
                  style={[s.sessionRow, isDark && s.cardDark]}
                  onPress={() =>
                    router.push({
                      pathname: "/session/[id]",
                      params: { id: session.id, ...(session.directory ? { directory: session.directory } : {}) },
                    })
                  }
                  testID={`swarm-session-${session.id}`}
                >
                  <View style={s.roleText}>
                    <Text style={[s.roleName, isDark && s.light]} numberOfLines={1}>
                      {session.title || "Untitled"}
                    </Text>
                    {previews[session.id]?.text && (
                      <Text style={[s.preview, isDark && s.dim]} numberOfLines={1}>
                        {previews[session.id].text}
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  center: { textAlign: "center", marginTop: 60 },
  dim: { color: "#888888" },
  light: { color: "#ffffff" },
  editAction: { fontSize: 16, fontWeight: "600", color: "#6d28d9" },
  label: { fontSize: 11, fontWeight: "700", color: "#888888", letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  cardDark: { backgroundColor: "#141414" },
  roleRow: {
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  roleText: { flex: 1, gap: 3 },
  roleName: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
  roleMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  skillChip: { backgroundColor: "#ede9fe", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  skillChipText: { fontSize: 10, fontWeight: "600", color: "#6d28d9" },
  modelText: { fontSize: 12, color: "#666666" },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  preview: { fontSize: 12, color: "#888888" },
})
