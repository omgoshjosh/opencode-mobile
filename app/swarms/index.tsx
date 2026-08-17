import { useCallback, useEffect } from "react"
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSwarms } from "../../src/stores/swarms"
import { isSwarmReady, type Swarm } from "../../src/lib/swarm-crud"

function SwarmRow({ swarm, isDark, onDelete }: { swarm: Swarm; isDark: boolean; onDelete: () => void }) {
  const ready = isSwarmReady(swarm.roles ?? [])
  const roleCount = swarm.roles?.length ?? 0

  return (
    <TouchableOpacity
      style={[s.row, isDark && s.rowDark]}
      onPress={() => router.push({ pathname: "/swarms/[id]", params: { id: swarm.id } })}
      onLongPress={onDelete}
      testID={`swarm-${swarm.id}`}
    >
      <View style={s.rowMain}>
        <View style={s.rowHeader}>
          <Ionicons name="people" size={16} color="#6d28d9" />
          <Text style={[s.title, isDark && s.textDark]} numberOfLines={1}>
            {swarm.title || "Untitled swarm"}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={[s.meta, isDark && s.metaDark]}>
            {roleCount} {roleCount === 1 ? "role" : "roles"}
          </Text>
          {/* A swarm that can't run is the main thing worth flagging here —
              it looks identical to a working one otherwise. */}
          {!ready && (
            <View style={s.warnBadge}>
              <Text style={s.warnText}>needs setup</Text>
            </View>
          )}
          {swarm.roles?.slice(0, 3).map((role) => (
            <View key={role.id ?? role.name} style={s.roleChip}>
              <Text style={s.roleChipText} numberOfLines={1}>
                {role.skill || role.name}
              </Text>
            </View>
          ))}
          {roleCount > 3 && <Text style={[s.meta, isDark && s.metaDark]}>+{roleCount - 3}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />
    </TouchableOpacity>
  )
}

export default function SwarmsScreen() {
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()
  const { swarms, isLoading, error, load, loadSkills, remove, clearError } = useSwarms()

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  // Prefetched here rather than in the editor so opening "new swarm" offers
  // skills immediately instead of after a round trip.
  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const confirmDelete = useCallback(
    (swarm: Swarm) => {
      Alert.alert(
        `Delete "${swarm.title}"?`,
        "Sessions already created by this swarm are kept; the team definition is removed.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => remove(swarm.id) },
        ],
      )
    },
    [remove],
  )

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      {error && (
        <TouchableOpacity style={s.errorBar} onPress={clearError}>
          <Text style={s.errorText}>{error}</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={swarms}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={isDark ? "#fff" : "#000"} />}
        renderItem={({ item }) => <SwarmRow swarm={item} isDark={isDark} onDelete={() => confirmDelete(item)} />}
        // Clear the FAB and the system navigation bar, so the last row is
        // reachable rather than sitting under both.
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={s.empty} color={isDark ? "#fff" : "#000"} />
          ) : (
            <View style={s.empty}>
              <Ionicons name="people-outline" size={40} color={isDark ? "#444" : "#ccc"} />
              <Text style={[s.emptyTitle, isDark && s.textDark]}>No swarms yet</Text>
              <Text style={[s.emptyBody, isDark && s.metaDark]}>
                A swarm is a team of roles you can pick like any model. Build one from your skills.
              </Text>
            </View>
          )
        }
      />

      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => router.push("/swarms/new")}
        testID="new-swarm"
        accessibilityLabel="New swarm"
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  rowDark: { borderBottomColor: "#1a1a1a" },
  rowMain: { flex: 1 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 16, fontWeight: "600", color: "#0a0a0a", flexShrink: 1 },
  textDark: { color: "#ffffff" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  meta: { fontSize: 12, color: "#666666" },
  metaDark: { color: "#888888" },
  roleChip: { backgroundColor: "#ede9fe", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  roleChipText: { fontSize: 10, color: "#6d28d9", fontWeight: "600", maxWidth: 90 },
  warnBadge: { backgroundColor: "#fef3c7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  warnText: { fontSize: 10, color: "#b45309", fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#0a0a0a" },
  emptyBody: { fontSize: 13, color: "#666666", textAlign: "center" },
  errorBar: { backgroundColor: "#fee2e2", paddingVertical: 8, paddingHorizontal: 16 },
  errorText: { color: "#b91c1c", fontSize: 13 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
})
