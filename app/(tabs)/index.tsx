import { useCallback, useMemo, useState, useRef, useEffect } from "react"
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useSessions } from "../../src/stores/sessions"
import { useConnections } from "../../src/stores/connections"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEvents } from "../../src/stores/events"
import { isHealthy } from "../../src/lib/sse-liveness"
import { useCatalog } from "../../src/stores/catalog"
import type BottomSheet from "@gorhom/bottom-sheet"
import type { Session, Project } from "../../src/lib/sdk"
import { DirectorySwitcher, DirectoryBrowserSheet } from "../../src/components/chat"
import { groupByDirectory } from "../../src/lib/session-grouping"
import {
  DEFAULT_GROUP_MODE,
  GROUP_MODES,
  UNGROUPED_KEY,
  groupKey,
  groupSortIndex,
  isGroupMode,
  type GroupMode,
} from "../../src/lib/session-group-modes"
import { statusCounts, type StatusCount } from "../../src/lib/session-status-counts"
import { depthOf, indexByID } from "../../src/lib/session-tree"
import {
  FILTERABLE_STATUSES,
  NO_FILTER,
  activeFilterCount,
  clearFilter,
  filterSummary,
  isFilterActive,
  matchesFilter,
  parseFilter,
  RECENCY_WINDOWS,
  setHideSubagents,
  setQuery,
  setRecency,
  toggleStatus,
  type SessionFilter,
} from "../../src/lib/session-filters"
import { modelDisplayLabel } from "../../src/lib/model-label"
import { SWARM_PROVIDER_ID } from "../../src/lib/swarm-model"
import { UpdateBanner } from "../../src/components/UpdateBanner"
import { PulsingDot } from "../../src/components/PulsingDot"
import {
  attentionFor,
  attentionLabel,
  isActionable,
  isAttentionWorthShowing,
  type Attention,
} from "../../src/lib/session-attention"
import { nameOf } from "../../src/lib/path-utils"
import { SETUP_GUIDE_URL } from "../../src/lib/links"

// Badge palette per attention state. "needs you" is the only red — it is the
// only state where the run is stopped waiting on the user.
// Holds only booleans and known status strings.
// See the allowlist in src/lib/persisted-keys.test.ts.
const SESSION_FILTER_KEY = "sessions_filter"

const ATTENTION_BADGE: Record<Attention, object> = {
  "needs-attention": { backgroundColor: "#fee2e2" },
  busy: { backgroundColor: "#dcfce7" },
  retry: { backgroundColor: "#fef3c7" },
  complete: { backgroundColor: "#dbeafe" },
  idle: {},
}

const ATTENTION_TEXT: Record<Attention, object> = {
  "needs-attention": { color: "#b91c1c", fontWeight: "700" },
  busy: { color: "#166534" },
  retry: { color: "#b45309" },
  complete: { color: "#1d4ed8" },
  idle: {},
}

function formatTime(timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return t("sessionsList.time.justNow")
  if (diff < 3600000) return t("sessionsList.time.minutesAgo", { count: Math.floor(diff / 60000) })
  if (diff < 86400000) return t("sessionsList.time.hoursAgo", { count: Math.floor(diff / 3600000) })
  if (diff < 604800000) return t("sessionsList.time.daysAgo", { count: Math.floor(diff / 86400000) })

  return date.toLocaleDateString()
}

function SessionItem({
  session,
  isDark,
  onRename,
  onDelete,
}: {
  session: Session
  isDark: boolean
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const onPress = () => {
    router.push({
      pathname: `/session/[id]`,
      params: { id: session.id, ...(session.directory ? { directory: session.directory } : {}) },
    })
  }

  const onLongPress = () => {
    Alert.alert(session.title || t("sessionsList.untitledSession"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("sessionsList.actions.rename"), onPress: onRename },
      { text: t("common.delete"), style: "destructive", onPress: onDelete },
    ])
  }

  // Extract short directory name from session
  const shortDir = session.directory ? session.directory.split("/").filter(Boolean).pop() : null

  // Swarm sessions show their team name so the list says which team owns a
  // session without opening it. Ordinary models aren't labelled here — the
  // directory badge is the more useful discriminator for those.
  const providers = useCatalog((c) => c.providers)
  const swarmLabel =
    session.model?.providerID === SWARM_PROVIDER_ID
      ? modelDisplayLabel(providers, { providerID: session.model.providerID, modelID: session.model.id })
      : null
  const ownStatus = useEvents((s) => (s.sessionStatus[session.id]?.type ?? "idle") as string)
  const preview = useSessions((s) => s.previews[session.id]?.text)
  // "idle" used to cover three different situations — blocked on you, finished
  // and unread, and genuinely quiet. See src/lib/session-attention.ts.
  const pendingPermissions = useEvents((s) => s.permissions[session.id]?.length ?? 0)
  const pendingQuestions = useEvents((s) => s.questions[session.id]?.length ?? 0)
  const lastViewedAt = useSessions((s) => s.lastViewed[session.id])
  const attention = attentionFor({
    status: ownStatus,
    pendingPermissions,
    pendingQuestions,
    updatedAt: session.time.updated,
    lastViewedAt,
  })

  return (
    <TouchableOpacity
      style={[styles.sessionItem, isDark && styles.sessionItemDark]}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`session-item-${session.id}`}
    >
      <View style={styles.sessionContent}>
        <View style={styles.sessionHeader}>
          <Text style={[styles.sessionTitle, isDark && styles.textDark]} numberOfLines={1}>
            {session.title || t("sessionsList.untitledSession")}
          </Text>
        </View>
        {/* What the session is actually talking about. Harvested from the SSE
            stream the client was already receiving, so this costs no requests
            — see src/lib/session-preview.ts. */}
        {preview && (
          <Text style={[styles.sessionPreview, isDark && styles.sessionPreviewDark]} numberOfLines={1}>
            {preview}
          </Text>
        )}
        <View style={styles.sessionMetaRow}>
          <Text style={[styles.sessionMeta, isDark && styles.metaDark]}>
            {formatTime(session.time.updated, t)}
            {/* summary is always present but files defaults to 0 until the
                server populates it — only show the count when it's meaningful,
                matching the SessionInfo panel's `summary.files > 0` guard (#55) */}
            {session.summary && session.summary.files > 0 &&
              ` · ${t("sessionsList.filesCount", { count: session.summary.files })}`}
          </Text>
          {swarmLabel && (
            <View style={styles.sessionSwarmBadge}>
              <Ionicons name="people-outline" size={12} color="#6d28d9" />
              <Text style={styles.sessionSwarmText} numberOfLines={1}>
                {swarmLabel}
              </Text>
            </View>
          )}
          {isAttentionWorthShowing(attention) && (
            <View style={[styles.statusBadge, ATTENTION_BADGE[attention]]}>
              {/* Icon as well as colour: "needs you" must not depend on hue
                  alone to be distinguishable. */}
              {isActionable(attention) && <Ionicons name="hand-left" size={11} color="#b91c1c" />}
              {/* A static badge says what state a session is in but not
                  whether it is still moving; a stalled run looks identical to
                  a progressing one across 30 rows. */}
              {(attention === "busy" || attention === "retry") && (
                <PulsingDot color={attention === "busy" ? "#16a34a" : "#b45309"} size={5} active />
              )}
              <Text style={[styles.statusBadgeText, ATTENTION_TEXT[attention]]}>{attentionLabel(attention)}</Text>
            </View>
          )}
          {shortDir && (
            <View style={styles.sessionDirBadge}>
              <Ionicons name="folder-outline" size={12} color={isDark ? "#888888" : "#666666"} />
              <Text style={[styles.sessionDirText, isDark && styles.metaDark]}>{shortDir}</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={isDark ? "#9a9a9a" : "#999999"} />
    </TouchableOpacity>
  )
}

// Deduped status counts for a group, e.g. "3 busy · 1 retry". Statuses with no
// members are omitted entirely rather than rendered as "0 idle" — see
// src/lib/session-status-counts.ts.
function StatusBadges({ counts, isDark }: { counts: StatusCount[]; isDark: boolean }) {
  if (counts.length === 0) return null
  return (
    <View style={styles.statusBadgeRow}>
      {counts.map((c) => (
        <View
          key={c.status}
          style={[
            styles.statusBadge,
            c.status === "busy" && styles.statusBadgeBusy,
            c.status === "retry" && styles.statusBadgeRetry,
            c.status === "idle" && (isDark ? styles.statusBadgeIdleDark : styles.statusBadgeIdle),
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              c.status === "busy" && styles.statusBadgeTextBusy,
              c.status === "retry" && styles.statusBadgeTextRetry,
              c.status === "idle" && styles.statusBadgeTextIdle,
            ]}
          >
            {c.count} {c.status}
          </Text>
        </View>
      ))}
    </View>
  )
}

// Flattened list row — either a collapsible group header or a session.
// A single flat array keeps FlatList's refresh/empty-state handling as-is
// instead of switching to SectionList.
type ListRow =
  | { type: "header"; directory: string; shortName: string; count: number; collapsed: boolean; sessionIDs: string[] }
  | { type: "session"; session: Session }

function GroupHeader({
  row,
  isDark,
  onToggle,
}: {
  row: { directory: string; shortName: string; count: number; collapsed: boolean; sessionIDs: string[] }
  isDark: boolean
  onToggle: () => void
}) {
  const sessionStatus = useEvents((s) => s.sessionStatus)
  const counts = statusCounts(row.sessionIDs, sessionStatus)
  return (
    <TouchableOpacity
      style={[styles.groupHeader, isDark && styles.groupHeaderDark]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <Ionicons name="folder-outline" size={16} color={isDark ? "#8b5cf6" : "#6d28d9"} />
      <Text style={[styles.groupHeaderText, isDark && styles.textDark]} numberOfLines={1}>
        {row.shortName}
      </Text>
      <StatusBadges counts={counts} isDark={isDark} />
      <Text style={[styles.groupHeaderCount, isDark && styles.metaDark]}>{row.count}</Text>
      <Ionicons
        name={row.collapsed ? "chevron-forward" : "chevron-down"}
        size={16}
        color={isDark ? "#9a9a9a" : "#999999"}
      />
    </TouchableOpacity>
  )
}

// Persisted grouping choice.
const GROUP_MODE_KEY = "sessions.groupMode"

const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  directory: "Project",
  swarm: "Swarm",
  root: "Swarm root",
  date: "Date",
  status: "Status",
}

// Human label for a group header under the current mode.
function groupLabel(
  key: string,
  mode: GroupMode,
  items: Session[],
  providers: { id: string; models: { id: string; name?: string }[] }[],
): string {
  if (key === UNGROUPED_KEY) {
    return mode === "swarm" ? "No swarm" : mode === "directory" ? "No project" : "Ungrouped"
  }
  if (mode === "swarm") return modelDisplayLabel(providers, { providerID: SWARM_PROVIDER_ID, modelID: key })
  if (mode === "root") {
    // Name the bucket after the root session so children read as belonging to it.
    const root = items.find((item) => item.id === key)
    return root?.title || items[0]?.title || key
  }
  if (mode === "status") return key
  if (mode === "date") return key
  return nameOf(key) || key
}

// Get short directory name (last folder or project name)
function getShortPath(
  project: { path?: { cwd?: string; root?: string; absolute?: string }; name?: string } | null | undefined,
): string {
  if (!project) return ""
  if (project.name) return project.name
  if (!project.path?.absolute) return ""
  const parts = project.path.absolute.split("/").filter(Boolean)
  return parts[parts.length - 1] || project.path.absolute
}

export default function SessionsScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()
  const [showNewSession, setShowNewSession] = useState(false)
  const [customDir, setCustomDir] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [renaming, setRenaming] = useState<Session | null>(null)
  const [renameText, setRenameText] = useState("")
  const renamingInFlight = useRef(false)
  // Synchronous re-entrancy guard: `isCreating` state lags by a render, so a
  // fast double-tap on the FAB / "Use this folder" would fire two session
  // creates before the disabled state lands. This blocks the second call.
  const creatingInFlight = useRef(false)
  const [serverProjects, setServerProjects] = useState<Project[]>([])

  const { sessions, isLoading, error, loadSessions, createSession, deleteSession } = useSessions()
  const {
    activeConnection,
    client,
    currentProject,
    serverHome,
    refreshProject,
    clientForDirectory,
    switchDirectory,
    addRecentDirectory,
    recentDirectories,
  } = useConnections()
  const authError = useEvents((s) => s.authError)
  const reconnect = useEvents((s) => s.connect)
  const loadCatalog = useCatalog((s) => s.load)
  const dirSheetRef = useRef<BottomSheet>(null)
  const browserSheetRef = useRef<BottomSheet>(null)
  const [browseStartDir, setBrowseStartDir] = useState<string | null>(null)
  // Shared folder browser is opened either to pick a directory for a new
  // session, or to switch the active connection's directory.
  const [browseMode, setBrowseMode] = useState<"create" | "switch">("create")
  const [refreshing, setRefreshing] = useState(false)
  // Directories collapsed in the grouped session list. Empty by default —
  // all groups start expanded (#67).
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  // Single-select grouping mode. One nesting level plus this picker replaces
  // what would otherwise be nested groups — see src/lib/session-group-modes.ts.
  const [groupMode, setGroupMode] = useState<GroupMode>(DEFAULT_GROUP_MODE)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const sessionStatusMap = useEvents((s) => s.sessionStatus)
  const transportHealthy = useEvents((s) => isHealthy(s.transport))
  const providersForLabels = useCatalog((c) => c.providers)
  // Inputs to the attention state, hoisted here because filtering happens
  // before rows are built — the row component computes the same thing for
  // display, but the list has to know it to decide what to show at all.
  const permissionsMap = useEvents((s) => s.permissions)
  const questionsMap = useEvents((s) => s.questions)
  const lastViewedMap = useSessions((s) => s.lastViewed)
  const [filter, setFilter] = useState<SessionFilter>(NO_FILTER)
  const [showFilters, setShowFilters] = useState(false)

  // Persisted so a narrowed list survives a relaunch — otherwise "only what
  // needs me" has to be re-applied every time the app is opened.
  useEffect(() => {
    AsyncStorage.getItem(SESSION_FILTER_KEY)
      .then((raw) => setFilter(parseFilter(raw)))
      .catch(() => {})
  }, [])
  const applyFilter = useCallback((next: SessionFilter) => {
    setFilter(next)
    AsyncStorage.setItem(SESSION_FILTER_KEY, JSON.stringify(next)).catch(() => {})
  }, [])

  // Read-state drives the complete/idle distinction, so it has to be restored
  // before the first list render or every row briefly claims to be unread.
  useEffect(() => {
    useSessions.getState().loadLastViewed()
  }, [])

  // Persist the choice so the list doesn't reset to Directory on every launch.
  useEffect(() => {
    AsyncStorage.getItem(GROUP_MODE_KEY)
      .then((v) => {
        if (isGroupMode(v)) setGroupMode(v)
      })
      .catch(() => {})
  }, [])
  const chooseGroupMode = useCallback((mode: GroupMode) => {
    setGroupMode(mode)
    setShowGroupPicker(false)
    // Collapse state is keyed by group key, which is mode-specific — carrying
    // it across a mode switch would collapse unrelated groups.
    setCollapsedDirs(new Set())
    AsyncStorage.setItem(GROUP_MODE_KEY, mode).catch(() => {})
  }, [])

  const toggleGroup = useCallback((directory: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(directory)) next.delete(directory)
      else next.add(directory)
      return next
    })
  }, [])

  // Flatten sessions into header+item rows under the selected grouping mode.
  // Skip headers entirely when everything lands in one group — a lone header
  // adds noise, not clarity.
  const rows = useMemo<ListRow[]>(() => {
    const nowMs = Date.now()
    const statusOf = (id: string) => sessionStatusMap[id]?.type
    // Needed by "root" mode to walk a session up to its topmost ancestor — a
    // swarm's subagents are grandchildren, not children. See session-tree.ts.
    const sessionsByID = indexByID(sessions)

    // Narrow before grouping, so an emptied group disappears rather than
    // rendering a header over nothing. groupLabel already falls back to the
    // first remaining item when a filter removes the root itself.
    const visible = isFilterActive(filter)
      ? sessions.filter((session) =>
          matchesFilter(
            {
              depth: depthOf(session, sessionsByID),
              title: session.title,
              updatedAt: session.time?.updated,
              attention: attentionFor({
                status: statusOf(session.id),
                pendingPermissions: permissionsMap[session.id]?.length ?? 0,
                pendingQuestions: questionsMap[session.id]?.length ?? 0,
                updatedAt: session.time?.updated,
                lastViewedAt: lastViewedMap[session.id],
              }),
            },
            filter,
            nowMs,
          ),
        )
      : sessions

    const buckets = new Map<string, Session[]>()
    const order: string[] = []
    for (const session of visible) {
      const key = groupKey(session as never, groupMode, { nowMs, statusOf, sessionsByID })
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = []
        buckets.set(key, bucket)
        order.push(key)
      }
      bucket.push(session)
    }
    if (order.length <= 1) {
      return visible.map((session) => ({ type: "session", session }))
    }
    // Stable sort: modes that define an order (date, status) use it; the rest
    // keep first-seen order. Ungrouped always sinks to the bottom.
    const sorted = order
      .map((key, index) => ({ key, index }))
      .sort((a, b) => groupSortIndex(a.key, groupMode) - groupSortIndex(b.key, groupMode) || a.index - b.index)
      .map((entry) => entry.key)

    const out: ListRow[] = []
    for (const key of sorted) {
      const items = buckets.get(key) as Session[]
      const collapsed = collapsedDirs.has(key)
      out.push({
        type: "header",
        directory: key,
        shortName: groupLabel(key, groupMode, items, providersForLabels),
        count: items.length,
        collapsed,
        sessionIDs: items.map((item) => item.id),
      })
      if (!collapsed) for (const session of items) out.push({ type: "session", session })
    }
    return out
  }, [
    sessions,
    collapsedDirs,
    groupMode,
    sessionStatusMap,
    providersForLabels,
    filter,
    permissionsMap,
    questionsMap,
    lastViewedMap,
  ])

  // Fetch server-known projects when the new session modal opens
  useEffect(() => {
    if (!showNewSession || !client) return
    client.project
      .list()
      .then(setServerProjects)
      .catch(() => setServerProjects([]))
  }, [showNewSession, client])

  const handleSwitchDirectory = useCallback(
    async (dir?: string) => {
      await switchDirectory(dir)
      loadSessions()
      refreshProject()
      loadCatalog()
    },
    [switchDirectory, loadSessions, refreshProject, loadCatalog],
  )

  useFocusEffect(
    useCallback(() => {
      if (client) {
        loadSessions()
        refreshProject()
      }
    }, [client, loadSessions, refreshProject]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadSessions(), refreshProject()])
    } catch (err) {
      console.error("Refresh failed:", err)
    } finally {
      setRefreshing(false)
    }
  }, [loadSessions, refreshProject])

  const handleRename = useCallback((session: Session) => {
    setRenameText(session.title || "")
    setRenaming(session)
  }, [])

  const submitRename = useCallback(async () => {
    const title = renameText.trim()
    if (!title || !renaming || renamingInFlight.current) return
    const renameClient = renaming.directory ? (clientForDirectory(renaming.directory) ?? client) : client
    if (!renameClient) return
    renamingInFlight.current = true
    try {
      await renameClient.session.update(renaming.id, { title })
      setRenaming(null)
      setRenameText("")
      loadSessions()
    } catch (err) {
      console.error("Rename failed:", err)
      Alert.alert(t("sessionsList.alerts.renameFailedTitle"), t("sessionsList.alerts.renameFailedMessage"))
    } finally {
      renamingInFlight.current = false
    }
  }, [renaming, renameText, client, clientForDirectory, loadSessions, t])

  const handleDelete = useCallback(
    (session: Session) => {
      Alert.alert(
        t("sessionsList.alerts.deleteTitle"),
        t("sessionsList.alerts.deleteMessage", { title: session.title || t("sessionsList.untitledSession") }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: async () => {
              try {
                await deleteSession(session.id)
              } catch (err) {
                console.error("Delete failed:", err)
                Alert.alert(t("sessionsList.alerts.deleteFailedTitle"), t("sessionsList.alerts.deleteFailedMessage"))
              }
            },
          },
        ],
      )
    },
    [deleteSession, t],
  )

  const onCreateSession = async () => {
    if (creatingInFlight.current) return
    creatingInFlight.current = true
    // Show progress on the FAB itself. Creating a session is a server round
    // trip; without feedback a slow one is indistinguishable from a dead
    // button, which is exactly how it was reported.
    setIsCreating(true)
    try {
      const session = await createSession()
      if (session) {
        router.push({
          pathname: `/session/[id]`,
          params: { id: session.id, ...(session.directory ? { directory: session.directory } : {}) },
        })
      } else {
        Alert.alert(t("common.error"), t("sessionsList.alerts.createFailedMessage"))
      }
    } finally {
      creatingInFlight.current = false
      setIsCreating(false)
    }
  }

  const onCreateInDirectory = async (dir?: string) => {
    if (!activeConnection) return
    if (creatingInFlight.current) return
    creatingInFlight.current = true
    setIsCreating(true)

    try {
      // If a custom directory is specified, use a one-off client for that directory
      // so we don't mutate the connection's default project
      if (dir && dir.trim()) {
        const dirClient = clientForDirectory(dir.trim())
        if (!dirClient) return
        try {
          const session = await dirClient.session.create({})
          addRecentDirectory(dir.trim())
          setShowNewSession(false)
          setCustomDir("")
          if (session) {
            router.push({
              pathname: `/session/[id]`,
              params: { id: session.id, ...(session.directory ? { directory: session.directory } : {}) },
            })
          }
        } catch (error) {
          console.error("Failed to create session in directory:", error)
          Alert.alert(t("common.error"), t("sessionsList.alerts.createFailedMessage"))
        }
        return
      }

      const session = await createSession()
      setShowNewSession(false)
      setCustomDir("")
      if (session) {
        router.push({
          pathname: `/session/[id]`,
          params: { id: session.id, ...(session.directory ? { directory: session.directory } : {}) },
        })
      } else {
        Alert.alert(t("common.error"), t("sessionsList.alerts.createFailedMessage"))
      }
    } finally {
      creatingInFlight.current = false
      setIsCreating(false)
    }
  }

  // The browser sheet is a sibling of the New Session <Modal>. A native RN
  // Modal layers above everything in the React root (including bottom-sheet
  // portals), so the modal must be closed before the sheet is shown; this ref
  // remembers to bring it back if the user cancels without picking a folder.
  const restoreNewSessionOnDismiss = useRef(false)

  const openBrowser = useCallback(
    (startDir: string | null, mode: "create" | "switch") => {
      setBrowseStartDir(startDir || serverHome || null)
      setBrowseMode(mode)
      if (mode === "create" && showNewSession) {
        restoreNewSessionOnDismiss.current = true
        setShowNewSession(false)
      }
      browserSheetRef.current?.expand()
    },
    [serverHome, showNewSession],
  )

  const onBrowserSelect = useCallback(
    (directory: string) => {
      restoreNewSessionOnDismiss.current = false
      if (browseMode === "switch") {
        handleSwitchDirectory(directory)
        dirSheetRef.current?.close()
      } else {
        onCreateInDirectory(directory)
      }
    },
    [browseMode, handleSwitchDirectory, onCreateInDirectory],
  )

  const onBrowserDismiss = useCallback(() => {
    if (restoreNewSessionOnDismiss.current) {
      restoreNewSessionOnDismiss.current = false
      setShowNewSession(true)
    }
  }, [])

  const onFabPress = () => {
    // Quick create in current project
    onCreateSession()
  }

  const onFabLongPress = () => {
    // Show modal with more options
    setCustomDir("")
    setShowNewSession(true)
  }

  if (!activeConnection) {
    return (
      <View style={[styles.emptyContainer, isDark && styles.containerDark]}>
        <Ionicons name="server-outline" size={64} color={isDark ? "#444444" : "#cccccc"} />
        <Text style={[styles.emptyTitle, isDark && styles.textDark]}>{t("sessionsList.empty.noConnectionTitle")}</Text>
        <Text style={[styles.emptySubtitle, isDark && styles.metaDark]}>
          {t("sessionsList.empty.noConnectionSubtitle")}
        </Text>
        <TouchableOpacity
          style={[styles.addButton, isDark && styles.addButtonDark]}
          onPress={() => router.push("/connection/add")}
          testID="add-connection-button"
        >
          <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark]}>
            {t("sessionsList.empty.addConnectionButton")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.setupGuideLink}
          onPress={() => Linking.openURL(SETUP_GUIDE_URL)}
          testID="setup-guide-link"
        >
          <Text style={styles.setupGuideLinkText}>{t("sessionsList.empty.setupGuideLink")}</Text>
        </TouchableOpacity>
        {/* No-server activation path (retention): a fully offline scripted
            demo, isolated from real connect/session state — see app/demo.tsx. */}
        <TouchableOpacity
          style={[styles.tryDemoButton, isDark && styles.tryDemoButtonDark]}
          onPress={() => router.push("/demo")}
          testID="try-demo-button"
        >
          <Ionicons name="play-circle-outline" size={16} color={isDark ? "#a78bfa" : "#6d28d9"} />
          <Text style={[styles.tryDemoButtonText, isDark && styles.tryDemoButtonTextDark]}>
            {t("sessionsList.empty.tryDemoButton")}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  // The SSE loop stopped retrying because the server rejected our
  // credentials (401/403) — no amount of pull-to-refresh fixes that, so
  // point the user straight at the fix instead of a spinner that never
  // resolves (issue #76).
  if (authError) {
    return (
      <View style={[styles.emptyContainer, isDark && styles.containerDark]}>
        <Ionicons name="lock-closed-outline" size={64} color={isDark ? "#444444" : "#cccccc"} />
        <Text style={[styles.emptyTitle, isDark && styles.textDark]}>{t("sessionsList.empty.authFailedTitle")}</Text>
        <Text style={[styles.emptySubtitle, isDark && styles.metaDark]}>
          {t("sessionsList.empty.authFailedSubtitle", { name: activeConnection.name })}
        </Text>
        <View style={styles.authErrorButtonRow}>
          <TouchableOpacity
            style={[styles.addButton, isDark && styles.addButtonDark]}
            onPress={() => router.push(`/connection/${activeConnection.id}`)}
            testID="fix-connection-button"
          >
            <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark]}>
              {t("sessionsList.empty.checkCredentialsButton")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addButton, isDark && styles.addButtonDark]}
            onPress={() => {
              // authError is cleared inside connect() itself once the retry
              // attempt starts (see src/stores/events.ts), so a manual
              // set() here isn't needed — just kick the SSE state machine.
              reconnect()
            }}
            testID="retry-connection-button"
          >
            <Text style={[styles.addButtonText, isDark && styles.addButtonTextDark]}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const shortPath = getShortPath(currentProject)

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Connection indicator — tap to switch project */}
      <TouchableOpacity
        style={[styles.connectionBar, isDark && styles.connectionBarDark]}
        onPress={() => dirSheetRef.current?.expand()}
        onLongPress={() => router.push("/(tabs)/connections")}
        activeOpacity={0.7}
        testID="connection-status-bar"
      >
        <View style={styles.connectionInfo}>
          {/* Reflects verified SSE liveness, not merely "a connection is
              selected". This was hardcoded green, so the indicator claimed
              health even while the stream was dead. */}
          <View
            style={[styles.connectionDot, { backgroundColor: transportHealthy ? "#22c55e" : "#f59e0b" }]}
            testID="connection-status-dot"
          />
          <Text style={[styles.connectionName, isDark && styles.textDark]} numberOfLines={1}>
            {activeConnection.name}
          </Text>
          {shortPath && (
            <>
              <Ionicons name="folder" size={14} color={isDark ? "#888888" : "#666666"} />
              <Text style={[styles.projectPath, isDark && styles.metaDark]} numberOfLines={1}>
                {shortPath}
              </Text>
            </>
          )}
        </View>
        <Ionicons name="swap-horizontal-outline" size={16} color={isDark ? "#9a9a9a" : "#999999"} />
      </TouchableOpacity>

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <UpdateBanner isDark={isDark} />

      {/* Group-by picker. One nesting level + this control replaces nested
          groups; "Swarm root" is the nested-swarm view. */}
      <View style={[styles.groupByBar, isDark && styles.groupByBarDark]}>
        <TouchableOpacity
          style={styles.groupByLeft}
          onPress={() => setShowGroupPicker(true)}
          activeOpacity={0.7}
          testID="group-by-picker"
        >
          <Ionicons name="albums-outline" size={14} color={isDark ? "#888888" : "#666666"} />
          <Text style={[styles.groupByText, isDark && styles.metaDark]} numberOfLines={1}>
            {GROUP_MODE_LABELS[groupMode]}
          </Text>
          <Ionicons name="chevron-down" size={14} color={isDark ? "#9a9a9a" : "#999999"} />
        </TouchableOpacity>

        {/* A narrowed list that doesn't say it is narrowed reads as missing
            data, so the summary is always visible rather than hidden behind
            the sheet. */}
        <TouchableOpacity
          style={[styles.filterBtn, isFilterActive(filter) && styles.filterBtnActive]}
          onPress={() => setShowFilters(true)}
          activeOpacity={0.7}
          testID="filter-picker"
        >
          <Ionicons
            name="funnel"
            size={13}
            color={isFilterActive(filter) ? "#6d28d9" : isDark ? "#888888" : "#666666"}
          />
          <Text
            style={[styles.filterBtnText, isFilterActive(filter) && styles.filterBtnTextActive]}
            numberOfLines={1}
          >
            {filterSummary(filter)}
          </Text>
          {activeFilterCount(filter) > 0 && (
            <View style={styles.filterCount}>
              <Text style={styles.filterCountText}>{activeFilterCount(filter)}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => setShowFilters(false)}>
        <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setShowFilters(false)}>
          <View style={[styles.filterSheet, isDark && styles.pickerSheetDark]}>
            <View style={styles.filterSheetHeader}>
              <Text style={[styles.filterSheetTitle, isDark && styles.textDark]}>Filter sessions</Text>
              {isFilterActive(filter) && (
                <TouchableOpacity onPress={() => applyFilter(clearFilter())} testID="filter-clear">
                  <Text style={styles.filterClear}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.filterToggleRow}
              onPress={() => applyFilter(setHideSubagents(filter, !filter.hideSubagents))}
              testID="filter-hide-subagents"
            >
              <View style={styles.filterToggleText}>
                <Text style={[styles.filterToggleTitle, isDark && styles.textDark]}>Hide subagents</Text>
                <Text style={[styles.filterToggleHint, isDark && styles.metaDark]}>
                  Show only sessions you started
                </Text>
              </View>
              <Ionicons
                name={filter.hideSubagents ? "checkbox" : "square-outline"}
                size={22}
                color={filter.hideSubagents ? "#8b5cf6" : isDark ? "#555" : "#c4c4c4"}
              />
            </TouchableOpacity>

            {/* Fuzzy, because titles are long and generated — remembering an
                exact contiguous fragment is the hard part. */}
            <Text style={[styles.filterGroupLabel, isDark && styles.metaDark]}>NAME</Text>
            <TextInput
              style={[styles.filterSearch, isDark && styles.filterSearchDark]}
              value={filter.query}
              onChangeText={(v) => applyFilter(setQuery(filter, v))}
              placeholder="Fuzzy match, e.g. reng"
              returnKeyType="search"
              placeholderTextColor={isDark ? "#666" : "#999"}
              autoCorrect={false}
              autoCapitalize="none"
              testID="filter-query"
            />

            <Text style={[styles.filterGroupLabel, isDark && styles.metaDark]}>UPDATED</Text>
            <View style={styles.filterChips}>
              {RECENCY_WINDOWS.map((window) => {
                const on = filter.recency === window.value
                return (
                  <TouchableOpacity
                    key={window.value}
                    style={[styles.filterChip, isDark && styles.filterChipDark, on && styles.filterChipOn]}
                    // Tapping the active window clears it, so the chips behave
                    // as a toggle rather than a one-way trap.
                    onPress={() => applyFilter(setRecency(filter, on ? "any" : window.value))}
                    testID={`filter-recency-${window.value}`}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isDark && styles.filterChipTextDark,
                        on && styles.filterChipTextOn,
                      ]}
                    >
                      {window.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={[styles.filterGroupLabel, isDark && styles.metaDark]}>STATUS</Text>
            <View style={styles.filterChips}>
              {FILTERABLE_STATUSES.map((status) => {
                const on = filter.statuses.includes(status)
                return (
                  <TouchableOpacity
                    key={status}
                    style={[styles.filterChip, isDark && styles.filterChipDark, on && styles.filterChipOn]}
                    onPress={() => applyFilter(toggleStatus(filter, status))}
                    testID={`filter-status-${status}`}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isDark && styles.filterChipTextDark,
                        on && styles.filterChipTextOn,
                      ]}
                    >
                      {attentionLabel(status)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Android's AlertDialog caps out at three buttons, which silently hid
          half the modes — use a real list instead. */}
      <Modal visible={showGroupPicker} transparent animationType="fade" onRequestClose={() => setShowGroupPicker(false)}>
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setShowGroupPicker(false)}
        >
          <View style={[styles.pickerSheet, isDark && styles.pickerSheetDark]}>
            <Text style={[styles.pickerTitle, isDark && styles.textDark]}>Group sessions by</Text>
            {GROUP_MODES.map((mode) => (
              <TouchableOpacity
                key={mode}
                style={styles.pickerRow}
                onPress={() => chooseGroupMode(mode)}
                testID={`group-mode-${mode}`}
              >
                <Text style={[styles.pickerRowText, isDark && styles.textDark]}>{GROUP_MODE_LABELS[mode]}</Text>
                {mode === groupMode && <Ionicons name="checkmark" size={18} color="#8b5cf6" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <FlatList
        data={rows}
        keyExtractor={(row) => (row.type === "header" ? `dir:${row.directory}` : row.session.id)}
        renderItem={({ item: row }) =>
          row.type === "header" ? (
            <GroupHeader row={row} isDark={isDark} onToggle={() => toggleGroup(row.directory)} />
          ) : (
            <SessionItem
              session={row.session}
              isDark={isDark}
              onRename={() => handleRename(row.session)}
              onDelete={() => handleDelete(row.session)}
            />
          )
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? "#ffffff" : "#0a0a0a"} />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
            </View>
          ) : isFilterActive(filter) ? (
            // "No sessions yet" is wrong when a filter is what emptied the
            // list — it reads as data loss and gives no way out. Name the
            // cause and offer the undo.
            <View style={styles.emptyList}>
              <Text style={[styles.emptyListText, isDark && styles.metaDark]}>
                No sessions match {filterSummary(filter)}.
              </Text>
              <TouchableOpacity onPress={() => applyFilter(clearFilter())} testID="empty-clear-filter">
                <Text style={styles.emptyClearFilter}>Clear filter</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyList}>
              <Text style={[styles.emptyListText, isDark && styles.metaDark]}>{t("sessionsList.empty.noSessions")}</Text>
            </View>
          )
        }
        contentContainerStyle={rows.length === 0 ? styles.emptyContent : undefined}
      />

      {/* FAB to create new session */}
      <TouchableOpacity
        style={[styles.fab, isDark && styles.fabDark, isCreating && styles.fabBusy]}
        onPress={onFabPress}
        onLongPress={onFabLongPress}
        delayLongPress={500}
        disabled={isCreating}
        testID="new-session-fab"
      >
        {isCreating ? (
          <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} testID="new-session-fab-spinner" />
        ) : (
          <Ionicons name="add" size={28} color={isDark ? "#0a0a0a" : "#ffffff"} />
        )}
      </TouchableOpacity>

      {/* New Session Info Modal */}
      <Modal visible={showNewSession} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setShowNewSession(false)} />
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isDark && styles.textDark]}>{t("sessionsList.newSessionModal.title")}</Text>
              <TouchableOpacity onPress={() => setShowNewSession(false)}>
                <Ionicons name="close" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody} keyboardShouldPersistTaps="handled">
              {/* Current directory — tapping creates session immediately */}
              <Text style={[styles.modalLabel, isDark && styles.metaDark]}>
                {t("sessionsList.newSessionModal.currentProjectLabel")}
              </Text>
              <TouchableOpacity
                style={[styles.modalDirBox, isDark && styles.modalDirBoxDark]}
                onPress={() => onCreateInDirectory()}
                disabled={isCreating}
              >
                <Ionicons name="folder" size={20} color={isDark ? "#8b5cf6" : "#6d28d9"} />
                <Text style={[styles.modalDirText, isDark && styles.textDark]} numberOfLines={2}>
                  {currentProject?.path?.absolute || activeConnection?.directory || t("sessionsList.newSessionModal.serverDefault")}
                </Text>
                <Ionicons name="arrow-forward-circle" size={20} color={isDark ? "#8b5cf6" : "#6d28d9"} />
              </TouchableOpacity>

              {/* Recent projects */}
              {recentDirectories.length > 0 && (
                <>
                  <Text style={[styles.modalLabel, isDark && styles.metaDark, { marginTop: 16 }]}>
                    {t("sessionsList.newSessionModal.recentProjectsLabel")}
                  </Text>
                  {recentDirectories.map((dir) => {
                    const short = dir.split("/").filter(Boolean).pop() || dir
                    const isCurrent =
                      dir === (currentProject?.path?.absolute || activeConnection?.directory)
                    return (
                      <TouchableOpacity
                        key={dir}
                        style={[
                          styles.projectRow,
                          isDark && styles.projectRowDark,
                          isCurrent && styles.projectRowActive,
                        ]}
                        onPress={() => onCreateInDirectory(dir)}
                        disabled={isCreating}
                      >
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={isCurrent ? "#8b5cf6" : isDark ? "#888888" : "#666666"}
                        />
                        <View style={styles.projectRowContent}>
                          <Text
                            style={[
                              styles.projectRowName,
                              isDark && styles.textDark,
                              isCurrent && styles.projectRowNameActive,
                            ]}
                            numberOfLines={1}
                          >
                            {short}
                          </Text>
                          <Text style={[styles.projectRowPath, isDark && styles.metaDark]} numberOfLines={1}>
                            {dir}
                          </Text>
                        </View>
                        {isCurrent && <Ionicons name="checkmark-circle" size={18} color="#8b5cf6" />}
                      </TouchableOpacity>
                    )
                  })}
                </>
              )}

              {/* Server-known projects (excluding current) */}
              {serverProjects.filter((p) => p.path?.absolute !== currentProject?.path?.absolute).length > 0 && (
                <>
                  <Text style={[styles.modalLabel, isDark && styles.metaDark, { marginTop: 16 }]}>
                    {t("sessionsList.newSessionModal.serverProjectsLabel")}
                  </Text>
                  {serverProjects
                    .filter((p) => p.path?.absolute !== currentProject?.path?.absolute)
                    .map((p) => {
                      const short = p.name || p.path?.absolute?.split("/").filter(Boolean).pop() || p.id
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.projectRow, isDark && styles.projectRowDark]}
                          onPress={() => onCreateInDirectory(p.path?.absolute)}
                          disabled={isCreating}
                        >
                          <Ionicons name="code-slash-outline" size={18} color={isDark ? "#888888" : "#666666"} />
                          <View style={styles.projectRowContent}>
                            <Text style={[styles.projectRowName, isDark && styles.textDark]} numberOfLines={1}>
                              {short}
                            </Text>
                            {p.path?.absolute && (
                              <Text style={[styles.projectRowPath, isDark && styles.metaDark]} numberOfLines={1}>
                                {p.path.absolute}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                      )
                    })}
                </>
              )}

              {/* Browse the server's filesystem instead of typing a path */}
              <TouchableOpacity
                style={[styles.projectRow, isDark && styles.projectRowDark, { marginTop: 16 }]}
                onPress={() =>
                  openBrowser(currentProject?.path?.absolute || activeConnection?.directory || null, "create")
                }
                disabled={isCreating}
                testID="browse-folders-button"
              >
                <Ionicons name="folder-open-outline" size={18} color={isDark ? "#8b5cf6" : "#6d28d9"} />
                <View style={styles.projectRowContent}>
                  <Text style={[styles.projectRowName, isDark && styles.textDark]}>
                    {t("sessionsList.newSessionModal.browseFoldersLabel")}
                  </Text>
                  <Text style={[styles.projectRowPath, isDark && styles.metaDark]}>
                    {t("sessionsList.newSessionModal.browseFoldersHint")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={isDark ? "#9a9a9a" : "#999999"} />
              </TouchableOpacity>

              {/* Manual path input fallback */}
              <Text style={[styles.modalLabel, isDark && styles.metaDark, { marginTop: 16 }]}>
                {t("sessionsList.newSessionModal.enterPathLabel")}
              </Text>
              <TextInput
                style={[styles.modalInput, isDark && styles.modalInputDark]}
                placeholder={serverHome ? `${serverHome}/...` : "/path/to/project"}
                placeholderTextColor={isDark ? "#9a9a9a" : "#999999"}
                value={customDir}
                onChangeText={(text) => {
                  // Expand ~ to server home directory
                  if (serverHome && text.startsWith("~/")) {
                    setCustomDir(serverHome + text.slice(1))
                  } else if (serverHome && text === "~") {
                    setCustomDir(serverHome)
                  } else {
                    setCustomDir(text)
                  }
                }}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {/* Quick path shortcuts */}
              {serverHome && (
                <View style={styles.pathChips}>
                  <TouchableOpacity
                    style={[styles.pathChip, isDark && styles.pathChipDark]}
                    onPress={() => setCustomDir(serverHome)}
                  >
                    <Text style={[styles.pathChipText, isDark && styles.pathChipTextDark]}>~</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pathChip, isDark && styles.pathChipDark]}
                    onPress={() => setCustomDir(serverHome + "/")}
                  >
                    <Text style={[styles.pathChipText, isDark && styles.pathChipTextDark]}>~/</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              {customDir.trim() ? (
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalButtonPrimary,
                    isDark && styles.modalButtonPrimaryDark,
                    styles.modalButtonFull,
                  ]}
                  onPress={() => onCreateInDirectory(customDir)}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                  ) : (
                    <Text style={[styles.modalButtonTextPrimary, isDark && styles.modalButtonTextPrimaryDark]}>
                      {t("sessionsList.newSessionModal.createInButton", {
                        dir: customDir.split("/").filter(Boolean).pop() || customDir,
                      })}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalButtonPrimary,
                    isDark && styles.modalButtonPrimaryDark,
                    styles.modalButtonFull,
                  ]}
                  onPress={() => onCreateInDirectory()}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                  ) : (
                    <Text style={[styles.modalButtonTextPrimary, isDark && styles.modalButtonTextPrimaryDark]}>
                      {t("sessionsList.newSessionModal.createSessionButton")}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rename modal */}
      <Modal visible={!!renaming} animationType="fade" transparent>
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { justifyContent: "center" }]}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setRenaming(null)} />
          <View style={[styles.renameCard, isDark && styles.renameCardDark]}>
            <Text style={[styles.renameTitle, isDark && styles.textDark]}>{t("sessionsList.renameModal.title")}</Text>
            <TextInput
              style={[styles.modalInput, isDark && styles.modalInputDark]}
              value={renameText}
              onChangeText={setRenameText}
              onSubmitEditing={submitRename}
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
              autoCapitalize="sentences"
              autoCorrect={false}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity style={[styles.renameBtn, styles.renameBtnCancel]} onPress={() => setRenaming(null)}>
                <Text style={styles.renameBtnCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameBtn, styles.modalButtonPrimary, isDark && styles.modalButtonPrimaryDark]}
                onPress={submitRename}
                disabled={!renameText.trim()}
              >
                <Text style={[styles.modalButtonTextPrimary, isDark && styles.modalButtonTextPrimaryDark]}>
                  {t("common.save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setRenaming(null)} />
        </KeyboardAvoidingView>
      </Modal>

      {/* Directory switcher bottom sheet */}
      <DirectorySwitcher
        sheetRef={dirSheetRef}
        current={activeConnection?.directory}
        recents={recentDirectories}
        serverHome={serverHome}
        isDark={isDark}
        onSwitch={handleSwitchDirectory}
        onBrowse={() =>
          openBrowser(activeConnection?.directory || currentProject?.path?.absolute || null, "switch")
        }
      />

      {/* Browsable folder picker — used for both "new session in..." and
          "switch project directory" flows (see browseMode). */}
      <DirectoryBrowserSheet
        sheetRef={browserSheetRef}
        startDirectory={browseStartDir}
        clientForDirectory={clientForDirectory}
        isDark={isDark}
        onSelect={onBrowserSelect}
        onDismiss={onBrowserDismiss}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  connectionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  connectionBarDark: {
    borderBottomColor: "#1a1a1a",
  },
  connectionInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  connectionUrl: {
    fontSize: 12,
    color: "#666666",
  },
  projectPath: {
    fontSize: 13,
    color: "#666666",
    flex: 1,
  },
  errorBar: {
    backgroundColor: "#fef2f2",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 14,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f5f5f5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  groupHeaderDark: {
    backgroundColor: "#151515",
    borderBottomColor: "#1a1a1a",
  },
  groupHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  groupHeaderCount: {
    fontSize: 12,
    color: "#666666",
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  sessionItemDark: {
    borderBottomColor: "#1a1a1a",
  },
  sessionContent: {
    flex: 1,
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#0a0a0a",
    marginBottom: 4,
  },
  textDark: {
    color: "#ffffff",
  },
  sessionMeta: {
    fontSize: 13,
    color: "#666666",
  },
  // Sits between the title and the meta row: quieter than the title, but
  // still readable — it is the line that tells you whether to open the row.
  filterSearch: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: "#0a0a0a",
    marginTop: 8,
  },
  filterSearchDark: { borderColor: "#222", color: "#ffffff" },
  emptyClearFilter: { fontSize: 14, fontWeight: "700", color: "#8b5cf6", marginTop: 10, textAlign: "center" },
  groupByLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    justifyContent: "flex-end",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  filterBtnActive: { backgroundColor: "#f5f3ff" },
  filterBtnText: { fontSize: 12, color: "#666666", flexShrink: 1 },
  filterBtnTextActive: { color: "#6d28d9", fontWeight: "600" },
  filterCount: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#8b5cf6",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterCountText: { color: "#ffffff", fontSize: 10, fontWeight: "700" },
  // Its own sheet rather than reusing pickerSheet: that one has no horizontal
  // padding at all — its rows each carry their own — so every control added to
  // it sat flush against the edge.
  filterSheet: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 22,
  },
  filterSheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  filterClear: { fontSize: 14, fontWeight: "600", color: "#8b5cf6", paddingVertical: 4, paddingLeft: 12 },
  filterToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
  },
  filterToggleText: { flex: 1, gap: 2 },
  filterToggleTitle: { fontSize: 16, color: "#0a0a0a" },
  filterToggleHint: { fontSize: 12, color: "#777777" },
  filterGroupLabel: { fontSize: 11, fontWeight: "700", color: "#888888", marginTop: 18, letterSpacing: 0.6 },
  filterChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d4d4d4",
  },
  // #666 on the dark sheet was barely legible — an unselected chip has to read
  // as a choice, not as disabled.
  filterChipDark: { borderColor: "#3f3f46" },
  filterChipOn: { backgroundColor: "#ede9fe", borderColor: "#8b5cf6" },
  filterChipText: { fontSize: 13, color: "#666666" },
  filterChipTextDark: { color: "#d4d4d8" },
  filterChipTextOn: { color: "#6d28d9", fontWeight: "700" },
  sessionPreview: { fontSize: 13, color: "#555555", marginTop: 2, marginBottom: 2 },
  sessionPreviewDark: { color: "#9a9a9a" },
  sessionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusBadgeRow: { flexDirection: "row", gap: 4, marginRight: 6 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  statusBadgeBusy: { backgroundColor: "#dcfce7" },
  statusBadgeRetry: { backgroundColor: "#fef3c7" },
  statusBadgeIdle: { backgroundColor: "#f1f5f9" },
  statusBadgeIdleDark: { backgroundColor: "#1f2937" },
  statusBadgeText: { fontSize: 10, fontWeight: "600" },
  statusBadgeTextBusy: { color: "#166534" },
  statusBadgeTextRetry: { color: "#92400e" },
  statusBadgeTextIdle: { color: "#64748b" },

  sessionSwarmBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#ede9fe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 160,
  },
  sessionSwarmText: { fontSize: 11, color: "#6d28d9", fontWeight: "600" },

  sessionDirBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sessionDirText: {
    fontSize: 11,
    color: "#666666",
  },
  metaDark: {
    color: "#888888",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#ffffff",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
    color: "#0a0a0a",
  },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 32 },
  pickerSheet: { backgroundColor: "#ffffff", borderRadius: 14, paddingVertical: 8 },
  pickerSheetDark: { backgroundColor: "#141420" },
  pickerTitle: { fontSize: 13, fontWeight: "700", color: "#666666", paddingHorizontal: 16, paddingVertical: 10 },
  // The filter sheet supplies its own padding, so its title must not add the
  // picker's horizontal inset on top.
  filterSheetTitle: { fontSize: 17, fontWeight: "700", color: "#0a0a0a", paddingHorizontal: 0, paddingVertical: 0 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pickerRowText: { fontSize: 16, color: "#0a0a0a" },

  fabBusy: { opacity: 0.7 },

  groupByBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  groupByBarDark: { borderBottomColor: "#2a2a2a" },
  groupByText: { fontSize: 12, color: "#666666", fontWeight: "600" },

  emptySubtitle: {
    fontSize: 14,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  addButton: {
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  authErrorButtonRow: {
    flexDirection: "row",
    gap: 12,
  },
  addButtonDark: {
    backgroundColor: "#ffffff",
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  addButtonTextDark: {
    color: "#0a0a0a",
  },
  setupGuideLink: {
    marginTop: 16,
  },
  setupGuideLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6366f1",
  },
  tryDemoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#8b5cf6",
  },
  tryDemoButtonDark: {
    borderColor: "#a78bfa",
  },
  tryDemoButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6d28d9",
  },
  tryDemoButtonTextDark: {
    color: "#a78bfa",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyListText: {
    fontSize: 16,
    color: "#666666",
  },
  emptyContent: {
    flex: 1,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabDark: {
    backgroundColor: "#ffffff",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalDismiss: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalContentDark: {
    backgroundColor: "#1a1a1a",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  modalBody: {
    marginBottom: 24,
  },
  modalScrollBody: {
    maxHeight: 420,
    marginBottom: 16,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#f5f5f5",
    marginBottom: 6,
  },
  projectRowDark: {
    backgroundColor: "#2a2a2a",
  },
  projectRowActive: {
    backgroundColor: "#f5f3ff",
  },
  projectRowContent: {
    flex: 1,
  },
  projectRowName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  projectRowNameActive: {
    color: "#8b5cf6",
  },
  projectRowPath: {
    fontSize: 11,
    color: "#999999",
    marginTop: 1,
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  modalDirBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 12,
  },
  modalDirBoxDark: {
    backgroundColor: "#2a2a2a",
  },
  modalDirText: {
    fontSize: 15,
    color: "#0a0a0a",
    flex: 1,
  },
  modalInput: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: "#0a0a0a",
  },
  modalInputDark: {
    backgroundColor: "#2a2a2a",
    color: "#ffffff",
  },
  pathChips: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  pathChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#e8e5f0",
    borderRadius: 16,
  },
  pathChipDark: {
    backgroundColor: "#2a2040",
  },
  pathChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6d28d9",
  },
  pathChipTextDark: {
    color: "#c4b5fd",
  },
  modalHint: {
    fontSize: 13,
    color: "#666666",
    marginTop: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  modalButtonSecondary: {
    backgroundColor: "#f5f5f5",
  },
  modalButtonSecondaryDark: {
    backgroundColor: "#2a2a2a",
  },
  modalButtonPrimary: {
    backgroundColor: "#0a0a0a",
  },
  modalButtonPrimaryDark: {
    backgroundColor: "#ffffff",
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  modalButtonTextPrimary: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  modalButtonTextPrimaryDark: {
    color: "#0a0a0a",
  },
  modalButtonFull: {
    flex: 0,
    width: "100%",
  },
  // Rename modal
  renameCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 32,
    gap: 16,
  },
  renameCardDark: {
    backgroundColor: "#1a1a1a",
  },
  renameTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  renameActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  renameBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  renameBtnCancel: {
    backgroundColor: "transparent",
  },
  renameBtnCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#888888",
  },
})
