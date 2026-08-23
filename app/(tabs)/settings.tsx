import { useCallback, useEffect, useState } from "react"
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  useColorScheme,
  Linking,
  Alert,
} from "react-native"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import * as Application from "expo-application"
import { clientInfoFrom, clientInfoLabel } from "../../src/lib/client-info"
import { useAuth } from "../../src/stores/auth"
import { useSettings } from "../../src/stores/settings"
import {
  categories,
  categoryMeta,
  setup as setupNotifications,
  granted as notificationsGranted,
} from "../../src/lib/notifications"
import type { Category } from "../../src/lib/notifications"
import { hasTelemetryConsent, setTelemetryConsent } from "../../src/lib/telemetry"
import { PRIVACY_POLICY_URL } from "../../src/lib/links"
import { CURRENT_VERSION } from "../../src/lib/update-check"
import { useUpdate } from "../../src/stores/update"
import { isSpecificZone } from "../../src/lib/timestamp-shorthand"
import { zoneDisplayLabel } from "../../src/lib/zone-list"
import type { LocalePreference } from "../../src/lib/i18n/locale-resolve"

function SettingRow({
  icon,
  label,
  description,
  isDark,
  right,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  description?: string
  isDark: boolean
  right?: React.ReactNode
  onPress?: () => void
}) {
  const content = (
    <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
      <View style={[styles.settingIcon, isDark && styles.settingIconDark]}>
        <Ionicons name={icon} size={22} color={isDark ? "#ffffff" : "#0a0a0a"} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingLabel, isDark && styles.textDark]}>{label}</Text>
        {description && <Text style={[styles.settingDescription, isDark && styles.metaDark]}>{description}</Text>}
      </View>
      {right}
    </View>
  )

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>
  }

  return content
}

function SettingSection({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{title}</Text>
      <View style={[styles.sectionContent, isDark && styles.sectionContentDark]}>{children}</View>
    </View>
  )
}

// Read from the native package rather than a literal: this row said "1.0.0"
// regardless of what was installed, so the one place a user checks to answer
// "which build am I on?" actively misled them.
const appVersionLabel = clientInfoLabel(
  clientInfoFrom({
    version: Application.nativeApplicationVersion,
    build: Application.nativeBuildVersion,
    platform: "",
  }),
)

export default function SettingsScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { settings, hasBiometrics, updateSettings, lock } = useAuth()
  const {
    notifications,
    setNotification,
    locale,
    setLocale,
    theme,
    setTheme,
    sessionsListV2,
    setSessionsListV2,
    timeZone,
    setTimeZone,
    clock,
    setClock,
  } = useSettings()
  const [osGranted, setOsGranted] = useState<boolean | null>(null)
  const [telemetryUpdating, setTelemetryUpdating] = useState(false)

  // Settings is where a user goes to ask "what am I running?". Answer it, and if
  // a newer build exists say so here too — the banner on the sessions list is
  // dismissible, this row is not (AGE-110). Uses the same 24h-throttled check,
  // so opening Settings repeatedly costs no extra requests.
  // Shared with the tab-bar badge (src/stores/update.ts): one verdict,
  // refreshed at launch and on foreground; opening Settings re-reads it so a
  // just-published release shows up without waiting for the next foreground.
  const updateAvailable = useUpdate((s) => s.available)
  useEffect(() => {
    useUpdate.getState().refresh()
  }, [])

  // Telemetry consent: hasTelemetryConsent() returns null (unknown), true, or false.
  // We initialise local state from in-memory value; updates call setTelemetryConsent().
  const [crashReporting, setCrashReporting] = useState<boolean>(hasTelemetryConsent() ?? false)

  const handleCrashReportingToggle = useCallback(
    async (value: boolean) => {
      setTelemetryUpdating(true)
      try {
        await setTelemetryConsent(value)
        setCrashReporting(value)
      } catch {
        setCrashReporting(hasTelemetryConsent() ?? false)
        Alert.alert(t("settings.alerts.privacyNotSavedTitle"), t("settings.alerts.privacyNotSavedMessage"))
      } finally {
        setTelemetryUpdating(false)
      }
    },
    [t],
  )

  // Check OS permission state on first toggle attempt
  const handleToggle = useCallback(
    async (category: Category, enabled: boolean) => {
      if (enabled) {
        const ok = await setupNotifications()
        setOsGranted(ok)
        if (!ok) {
          Alert.alert(t("settings.alerts.notificationsDisabledTitle"), t("settings.alerts.notificationsDisabledMessage"))
          return
        }
      }
      setNotification(category, enabled)
    },
    [setNotification, t],
  )

  // Lazy-check OS permission for status display
  if (osGranted === null) {
    notificationsGranted()
      .then(setOsGranted)
      .catch(() => setOsGranted(false))
  }

  const localeLabels: Record<LocalePreference, string> = {
    system: t("settings.language.system"),
    en: t("settings.language.en"),
    "zh-Hans": t("settings.language.zhHans"),
  }

  const handleLanguagePress = useCallback(() => {
    Alert.alert(t("settings.language.title"), undefined, [
      { text: localeLabels.system, onPress: () => setLocale("system") },
      { text: localeLabels.en, onPress: () => setLocale("en") },
      { text: localeLabels["zh-Hans"], onPress: () => setLocale("zh-Hans") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, setLocale, localeLabels])

  const themeLabels: Record<typeof theme, string> = {
    system: t("settings.theme.system"),
    light: t("settings.theme.light"),
    dark: t("settings.theme.dark"),
  }

  const handleThemePress = useCallback(() => {
    Alert.alert(t("settings.theme.title"), undefined, [
      { text: themeLabels.system, onPress: () => setTheme("system") },
      { text: themeLabels.light, onPress: () => setTheme("light") },
      { text: themeLabels.dark, onPress: () => setTheme("dark") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, setTheme, themeLabels])

  const clockLabels: Record<typeof clock, string> = {
    system: t("settings.clock.system"),
    "12h": t("settings.clock.h12"),
    "24h": t("settings.clock.h24"),
  }

  const handleClockPress = useCallback(() => {
    Alert.alert(t("settings.clock.title"), undefined, [
      { text: clockLabels.system, onPress: () => setClock("system") },
      { text: clockLabels["12h"], onPress: () => setClock("12h") },
      { text: clockLabels["24h"], onPress: () => setClock("24h") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, setClock, clockLabels])

  // A specific IANA zone labels itself by city ("Los Angeles · America");
  // local/utc keep their translated names.
  const timeZoneLabel = isSpecificZone(timeZone)
    ? zoneDisplayLabel(timeZone)
    : timeZone === "utc"
      ? t("settings.timezone.utc")
      : t("settings.timezone.local")

  // Single-select: Local and UTC inline; "Specific…" opens the searchable
  // picker (app/timezone.tsx) — an Alert can't hold 400 zones.
  const handleTimeZonePress = useCallback(() => {
    Alert.alert(t("settings.timezone.title"), undefined, [
      { text: t("settings.timezone.local"), onPress: () => setTimeZone("local") },
      { text: t("settings.timezone.utc"), onPress: () => setTimeZone("utc") },
      { text: t("settings.timezone.specific"), onPress: () => router.push("/timezone") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, setTimeZone])

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content}>
      {/* The Settings tab icon wears a dot when an update exists; this row is
          what the dot points at — first thing on the page, tinted, one tap to
          the release. The About row below keeps the exact version arrow. */}
      {updateAvailable && (
        <TouchableOpacity
          style={[styles.updateCard, isDark && styles.updateCardDark]}
          onPress={() => Linking.openURL(updateAvailable.url)}
          activeOpacity={0.7}
          testID="settings-update-card"
        >
          <Ionicons name="arrow-up-circle" size={22} color={isDark ? "#a78bfa" : "#6d28d9"} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.updateCardTitle, isDark && { color: "#e9d5ff" }]}>{t("update.available")}</Text>
            <Text style={[styles.updateCardBody, isDark && { color: "#c4b5fd" }]}>
              {t("update.body", { version: updateAvailable.version, current: CURRENT_VERSION })}
            </Text>
          </View>
          <Text style={[styles.updateCardAction, isDark && { color: "#a78bfa" }]}>{t("update.action")}</Text>
        </TouchableOpacity>
      )}
      {/* Swarms are models you can pick in any session, so managing them
          belongs with the app's own configuration rather than inside a
          session. */}
      <SettingSection title="Teams" isDark={isDark}>
        <SettingRow
          icon="people"
          label="Swarms"
          description="Create and edit agent teams from your skills"
          isDark={isDark}
          onPress={() => router.push("/swarms")}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.security")} isDark={isDark}>
        <SettingRow
          icon="finger-print"
          label={t("settings.security.biometricOpen.label")}
          description={
            hasBiometrics
              ? t("settings.security.biometricOpen.descriptionEnabled")
              : t("settings.security.biometricOpen.descriptionUnavailable")
          }
          isDark={isDark}
          right={
            <Switch
              value={settings.requireBiometric}
              onValueChange={(value) => updateSettings({ requireBiometric: value })}
              disabled={!hasBiometrics}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        <SettingRow
          icon="lock-closed"
          label={t("settings.security.biometricSend.label")}
          description={t("settings.security.biometricSend.description")}
          isDark={isDark}
          right={
            <Switch
              value={settings.requireBiometricForMessages}
              onValueChange={(value) => updateSettings({ requireBiometricForMessages: value })}
              disabled={!hasBiometrics || !settings.requireBiometric}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        {settings.requireBiometric && (
          <SettingRow
            icon="exit"
            label={t("settings.security.lockNow.label")}
            description={t("settings.security.lockNow.description")}
            isDark={isDark}
            onPress={lock}
            right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
          />
        )}
      </SettingSection>

      <SettingSection title={t("settings.sections.notifications")} isDark={isDark}>
        {categories.map((category) => {
          const meta = categoryMeta[category]
          return (
            <SettingRow
              key={category}
              icon={meta.icon as keyof typeof Ionicons.glyphMap}
              label={t(meta.labelKey)}
              description={t(meta.descriptionKey)}
              isDark={isDark}
              right={
                <Switch
                  value={notifications[category]}
                  onValueChange={(value) => handleToggle(category, value)}
                  trackColor={{ false: "#767577", true: "#22c55e" }}
                />
              }
            />
          )
        })}
        {osGranted === false && (
          <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
            <Text style={[styles.settingDescription, { color: "#ef4444", paddingLeft: 48 }]}>
              {t("settings.notifications.disabledNotice")}
            </Text>
          </View>
        )}
      </SettingSection>

      <SettingSection title={t("settings.sections.privacy")} isDark={isDark}>
        <SettingRow
          icon="shield-checkmark"
          label={t("settings.privacy.crashReporting.label")}
          description={t("settings.privacy.crashReporting.description")}
          isDark={isDark}
          right={
            <Switch
              value={crashReporting}
              onValueChange={handleCrashReportingToggle}
              disabled={telemetryUpdating}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        <SettingRow
          icon="document-text"
          label={t("settings.privacy.privacyPolicy.label")}
          description={t("settings.privacy.privacyPolicy.description")}
          isDark={isDark}
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
      </SettingSection>

      {/* Experiments: redesigns you can try and back out of with one switch.
          Nothing here migrates data — off always restores the classic UI. */}
      <SettingSection title={t("settings.sections.experiments")} isDark={isDark}>
        <SettingRow
          icon="flask"
          label={t("settings.experiments.sessionsListV2.label")}
          description={t("settings.experiments.sessionsListV2.description")}
          isDark={isDark}
          right={
            <Switch
              value={sessionsListV2}
              onValueChange={setSessionsListV2}
              trackColor={{ false: "#767577", true: "#22c55e" }}
              testID="toggle-sessions-list-v2"
            />
          }
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.about")} isDark={isDark}>
        <SettingRow
          icon="moon"
          label={t("settings.theme.label")}
          description={themeLabels[theme]}
          isDark={isDark}
          onPress={handleThemePress}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
        <SettingRow
          icon="alarm"
          label={t("settings.clock.label")}
          description={clockLabels[clock]}
          isDark={isDark}
          onPress={handleClockPress}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
        <SettingRow
          icon="time"
          label={t("settings.timezone.label")}
          description={timeZoneLabel}
          isDark={isDark}
          onPress={handleTimeZonePress}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
        <SettingRow
          icon="language"
          label={t("settings.language.label")}
          description={localeLabels[locale]}
          isDark={isDark}
          onPress={handleLanguagePress}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
        <SettingRow
          icon="information-circle"
          label={t("settings.about.version")}
          // Was hard-coded "1.0.0" — wrong for every build ever shipped, and the
          // one place a user could have checked what they are running while 64%
          // of the base sat on a four-week-old build (AGE-110).
          //
          // appVersionLabel carries the build number as well as the version.
          // Sideloaded evaluation builds share a versionName across many CI
          // builds, so the version alone cannot identify which APK is installed.
          description={
            updateAvailable
              ? `${appVersionLabel} → ${updateAvailable.version}`
              : `${appVersionLabel} · ${t("update.upToDate")}`
          }
          isDark={isDark}
          onPress={updateAvailable ? () => Linking.openURL(updateAvailable.url) : undefined}
          right={
            updateAvailable ? (
              <Ionicons name="arrow-up-circle" size={20} color={isDark ? "#7dd3fc" : "#0369a1"} />
            ) : undefined
          }
        />
        <SettingRow
          icon="logo-github"
          label={t("settings.about.github.label")}
          description={t("settings.about.github.description")}
          isDark={isDark}
          onPress={() => Linking.openURL("https://github.com/anomalyco/opencode")}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
        <SettingRow
          icon="document-text"
          label={t("settings.about.docs.label")}
          description={t("settings.about.docs.description")}
          isDark={isDark}
          onPress={() => Linking.openURL("https://opencode.ai/docs")}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#9a9a9a" : "#999999"} />}
        />
      </SettingSection>

      <View style={styles.footer}>
        <Text style={[styles.footerText, isDark && styles.metaDark]}>{t("settings.footer.appName")}</Text>
        <Text style={[styles.footerText, isDark && styles.metaDark]}>{t("settings.footer.tagline")}</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  content: {
    paddingBottom: 32,
  },
  // Update flair — accent-tinted, not alarm-coloured: an update is news,
  // not an error.
  updateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f5f3ff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  updateCardDark: { backgroundColor: "#1e1b2e" },
  updateCardTitle: { fontSize: 14, fontWeight: "700", color: "#4c1d95" },
  updateCardBody: { fontSize: 12, color: "#6d28d9", marginTop: 1 },
  updateCardAction: { fontSize: 13, fontWeight: "700", color: "#6d28d9" },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
    marginLeft: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  sectionTitleDark: {
    color: "#888888",
  },
  sectionContent: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e5e5",
  },
  sectionContentDark: {
    backgroundColor: "#1a1a1a",
    borderColor: "#2a2a2a",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  settingRowDark: {
    borderBottomColor: "#2a2a2a",
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  settingIconDark: {
    backgroundColor: "#2a2a2a",
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: "#0a0a0a",
  },
  textDark: {
    color: "#ffffff",
  },
  settingDescription: {
    fontSize: 13,
    color: "#666666",
    marginTop: 2,
  },
  metaDark: {
    color: "#888888",
  },
  footer: {
    alignItems: "center",
    padding: 32,
  },
  footerText: {
    fontSize: 13,
    color: "#999999",
    textAlign: "center",
  },
})
