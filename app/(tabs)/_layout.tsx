import { Tabs } from "expo-router"
import { useColorScheme, View, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useUpdate } from "../../src/stores/update"

// The settings gear wears a dot when a newer build exists: the tab bar is
// the only chrome visible from every screen, so it is the one place an
// ambient "there's an update" can live without interrupting anything.
// A dot, not a count — there is never more than one update.
function SettingsTabIcon({ color, size, showDot }: { color: string; size: number; showDot: boolean }) {
  return (
    <View>
      <Ionicons name="settings-outline" size={size} color={color} />
      {showDot && <View style={badgeStyles.dot} testID="settings-update-dot" />}
    </View>
  )
}

const badgeStyles = StyleSheet.create({
  dot: {
    position: "absolute",
    top: -1,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#8b5cf6",
  },
})

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()
  const updateAvailable = useUpdate((s) => s.available !== null)

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isDark ? "#ffffff" : "#0a0a0a",
        tabBarInactiveTintColor: isDark ? "#9a9a9a" : "#999999",
        tabBarStyle: {
          backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
          borderTopColor: isDark ? "#1a1a1a" : "#e5e5e5",
        },
        headerStyle: {
          backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
        },
        headerTintColor: isDark ? "#ffffff" : "#0a0a0a",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("nav.sessionsTab"),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="connections"
        options={{
          title: t("nav.connectionsTab"),
          tabBarIcon: ({ color, size }) => <Ionicons name="server-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("nav.settingsTab"),
          tabBarIcon: ({ color, size }) => <SettingsTabIcon color={color} size={size} showDot={updateAvailable} />,
        }}
      />
    </Tabs>
  )
}
