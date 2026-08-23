import { useMemo, useState } from "react"
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, useColorScheme } from "react-native"
import { Stack, router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useSettings } from "../src/stores/settings"
import { isSpecificZone, isValidZone } from "../src/lib/timestamp-shorthand"
import { availableZones, filterZones, zoneDisplayLabel } from "../src/lib/zone-list"

/**
 * Specific-time-zone picker (Settings > Time zone > Specific…).
 *
 * The full IANA list when the runtime provides it, a curated fallback when
 * it doesn't (src/lib/zone-list.ts) — searchable either way, because
 * scrolling 400 rows to find Tokyo is not a picker. Local and UTC stay in
 * the Settings alert; this screen exists only for the long tail.
 */
export default function TimeZoneScreen() {
  const { t } = useTranslation()
  const isDark = useColorScheme() === "dark"
  const timeZone = useSettings((s) => s.timeZone)
  const setTimeZone = useSettings((s) => s.setTimeZone)
  const [query, setQuery] = useState("")

  const zones = useMemo(() => availableZones(), [])
  const shown = useMemo(() => filterZones(zones, query), [zones, query])

  const choose = (zone: string) => {
    // Selection-time gate: an unloadable zone must never be persisted —
    // render-time falls back to labeled UTC, but why let it get that far.
    if (!isValidZone(zone)) return
    setTimeZone(zone)
    router.back()
  }

  return (
    <>
      <Stack.Screen options={{ title: t("settings.timezone.title") }} />
      <View style={[s.container, isDark && s.containerDark]}>
        <TextInput
          style={[s.search, isDark && s.searchDark]}
          placeholder={t("settings.timezone.searchPlaceholder")}
          placeholderTextColor={isDark ? "#9a9a9a" : "#999999"}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          testID="timezone-search"
        />
        <FlatList
          data={shown}
          keyExtractor={(zone) => zone}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: zone }) => (
            <TouchableOpacity style={s.row} onPress={() => choose(zone)} testID={`zone-${zone}`}>
              <View style={s.rowText}>
                <Text style={[s.city, isDark && s.light]}>{zoneDisplayLabel(zone)}</Text>
                <Text style={[s.iana, isDark && s.dim]}>{zone}</Text>
              </View>
              {isSpecificZone(timeZone) && timeZone === zone && (
                <Ionicons name="checkmark" size={18} color="#8b5cf6" />
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={[s.empty, isDark && s.dim]}>{`No time zones match “${query.trim()}”.`}</Text>
          }
        />
      </View>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  search: {
    margin: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#f4f4f5",
    fontSize: 15,
    color: "#0a0a0a",
  },
  searchDark: { backgroundColor: "#1a1a1a", color: "#ffffff" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowText: { flex: 1 },
  city: { fontSize: 15, color: "#0a0a0a" },
  iana: { fontSize: 12, color: "#888888", marginTop: 1 },
  light: { color: "#ffffff" },
  dim: { color: "#9a9a9a" },
  empty: { textAlign: "center", marginTop: 40, fontSize: 14, color: "#888888" },
})
