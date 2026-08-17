import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native"
import { Stack, router, useLocalSearchParams } from "expo-router"
import type BottomSheet from "@gorhom/bottom-sheet"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSwarms } from "../../src/stores/swarms"
import { useCatalog } from "../../src/stores/catalog"
import { modelDisplayLabel } from "../../src/lib/model-label"
import { SWARM_PROVIDER_ID } from "../../src/lib/swarm-model"
import { ModelPicker } from "../../src/components/chat"
import { keyboardVerticalOffset } from "../../src/lib/keyboard-offset"
import {
  addRole,
  moveRole,
  removeRole,
  roleFromSkill,
  swarmBlocker,
  toRoleInput,
  unusedSkills,
  updateRole,
  type RoleInput,
} from "../../src/lib/swarm-crud"

export default function SwarmEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isNew = id === "new"
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()

  const { swarms, skills, isSaving, error, save, loadSkills, clearError } = useSwarms()
  const allProviders = useCatalog((c) => c.providers)
  // A role runs on a real model. Offering the synthetic `swarm` provider in
  // the PICKER would let a swarm be chosen as a role inside a swarm —
  // recursive, and the orchestrator route would resolve to another facade
  // rather than a model.
  const pickableProviders = useMemo(
    () => (allProviders ?? []).filter((p) => p.id !== SWARM_PROVIDER_ID),
    [allProviders],
  )
  const existing = useMemo(() => swarms.find((s) => s.id === id), [swarms, id])

  const [title, setTitle] = useState("")
  const [roles, setRoles] = useState<RoleInput[]>([])
  const [showSkills, setShowSkills] = useState(false)
  const [modelForIndex, setModelForIndex] = useState<number | null>(null)
  const modelSheetRef = useRef<BottomSheet>(null)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate once. Re-running on every `existing` change would discard edits in
  // progress each time the list refreshed underneath.
  useEffect(() => {
    if (hydrated || isNew) return
    if (!existing) return
    setTitle(existing.title ?? "")
    setRoles((existing.roles ?? []).map(toRoleInput))
    setHydrated(true)
  }, [existing, hydrated, isNew])

  useEffect(() => {
    if (skills.length === 0) loadSkills()
  }, [skills.length, loadSkills])

  const available = useMemo(() => unusedSkills(skills, roles), [skills, roles])
  const blocker = swarmBlocker(title, roles)

  const onSave = useCallback(async () => {
    if (blocker) {
      Alert.alert("Not ready yet", blocker)
      return
    }
    const saved = await save({ swarmID: isNew ? undefined : id, title: title.trim(), roles })
    if (saved) router.back()
  }, [blocker, save, isNew, id, title, roles])

  const openModelPicker = useCallback((index: number) => {
    setModelForIndex(index)
    modelSheetRef.current?.expand()
  }, [])

  const pickModel = useCallback(
    (providerID: string, modelID: string) => {
      if (modelForIndex === null) return
      setRoles((prev) => updateRole(prev, modelForIndex, { providerID, modelID }))
      setModelForIndex(null)
    },
    [modelForIndex],
  )

  return (
    <>
      <Stack.Screen
        options={{
          title: isNew ? "New swarm" : "Edit swarm",
          headerRight: () => (
            <TouchableOpacity onPress={onSave} disabled={isSaving} hitSlop={8} testID="save-swarm">
              <Text style={[s.headerAction, (isSaving || blocker) && s.headerActionMuted]}>
                {isSaving ? "Saving…" : "Save"}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={[s.container, isDark && s.containerDark]}
        behavior="padding"
        keyboardVerticalOffset={keyboardVerticalOffset(Platform.OS, insets.top)}
      >
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 48 }]}
          keyboardShouldPersistTaps="handled"
        >
          {error && (
            <TouchableOpacity style={s.errorBar} onPress={clearError}>
              <Text style={s.errorText}>{error}</Text>
            </TouchableOpacity>
          )}

          <Text style={[s.label, isDark && s.labelDark]}>NAME</Text>
          <TextInput
            style={[s.input, isDark && s.inputDark]}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Reliability Team"
            placeholderTextColor={isDark ? "#666" : "#999"}
            testID="swarm-title"
          />

          <View style={s.sectionHeader}>
            <Text style={[s.label, isDark && s.labelDark]}>ROLES</Text>
            {/* Skill-first: picking a skill produces a working role rather
                than an empty form to fill in. */}
            <TouchableOpacity onPress={() => setShowSkills(true)} testID="add-from-skill">
              <Text style={s.addLink}>+ From skill</Text>
            </TouchableOpacity>
          </View>

          {roles.length === 0 && (
            <Text style={[s.hint, isDark && s.labelDark]}>
              Add at least two roles. Starting from a skill fills in the name and instructions for you.
            </Text>
          )}

          {roles.map((role, index) => (
            <View key={`${role.skill ?? role.name}-${index}`} style={[s.roleCard, isDark && s.roleCardDark]}>
              <View style={s.roleHeader}>
                <TextInput
                  style={[s.roleName, isDark && s.textDark]}
                  value={role.name}
                  onChangeText={(v) => setRoles((prev) => updateRole(prev, index, { name: v }))}
                  placeholder="Role name"
                  placeholderTextColor={isDark ? "#666" : "#999"}
                />
                <TouchableOpacity onPress={() => setRoles((prev) => moveRole(prev, index, index - 1))} hitSlop={6}>
                  <Ionicons name="chevron-up" size={18} color={index === 0 ? "#ccc" : isDark ? "#888" : "#666"} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRoles((prev) => moveRole(prev, index, index + 1))} hitSlop={6}>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={index === roles.length - 1 ? "#ccc" : isDark ? "#888" : "#666"}
                  />
                </TouchableOpacity>
                {/* Removal is local until save; the server only learns of it
                    when the whole role array is replaced. */}
                <TouchableOpacity onPress={() => setRoles((prev) => removeRole(prev, index))} hitSlop={6}>
                  <Ionicons name="trash-outline" size={17} color="#ef4444" />
                </TouchableOpacity>
              </View>

              {role.skill && (
                <View style={s.skillChip}>
                  <Ionicons name="sparkles-outline" size={11} color="#6d28d9" />
                  <Text style={s.skillChipText}>{role.skill}</Text>
                </View>
              )}

              <TextInput
                style={[s.instructions, isDark && s.inputDark]}
                value={role.instructions}
                onChangeText={(v) => setRoles((prev) => updateRole(prev, index, { instructions: v }))}
                placeholder="What this role does, and what it must not do"
                placeholderTextColor={isDark ? "#666" : "#999"}
                multiline
              />

              <TouchableOpacity
                style={[s.modelBtn, !role.modelID && s.modelBtnEmpty]}
                onPress={() => openModelPicker(index)}
                testID={`pick-model-${index}`}
              >
                <Ionicons name="hardware-chip-outline" size={14} color={role.modelID ? "#6d28d9" : "#b45309"} />
                <Text style={[s.modelBtnText, !role.modelID && s.modelBtnTextEmpty]} numberOfLines={1}>
                  {role.modelID
                    // Labels resolve against the FULL catalog: a role already
                    // pointed at a swarm by another client still deserves its
                    // name rather than a raw swm_ handle.
                    ? modelDisplayLabel(allProviders, { providerID: role.providerID ?? "", modelID: role.modelID })
                    : "Pick a model"}
                </Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={[s.addBlank, isDark && s.addBlankDark]}
            onPress={() => setRoles((prev) => addRole(prev, { name: "", instructions: "" }))}
            testID="add-blank-role"
          >
            <Ionicons name="add" size={16} color={isDark ? "#888" : "#666"} />
            <Text style={[s.addBlankText, isDark && s.labelDark]}>Add empty role</Text>
          </TouchableOpacity>

          {blocker && <Text style={s.blocker}>{blocker}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Skill picker */}
      <Modal visible={showSkills} transparent animationType="fade" onRequestClose={() => setShowSkills(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setShowSkills(false)}>
          {/* Bottom inset applied here, not in the stylesheet: without it the
              last row renders underneath the system navigation bar, clipped
              mid-sentence. */}
          <View style={[s.sheet, isDark && s.sheetDark, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetGrabber} />
            <Text style={[s.sheetTitle, isDark && s.textDark]}>Add a role from a skill</Text>
            <ScrollView style={s.sheetScroll}>
              {available.length === 0 && (
                <Text style={[s.hint, isDark && s.labelDark]}>
                  {skills.length === 0 ? "No skills found on this server." : "Every skill is already in use."}
                </Text>
              )}
              {available.map((skill) => (
                <TouchableOpacity
                  key={skill.name}
                  style={s.sheetRow}
                  onPress={() => {
                    setRoles((prev) => addRole(prev, roleFromSkill(skill)))
                    setShowSkills(false)
                  }}
                  testID={`skill-${skill.name}`}
                >
                  <Text style={[s.sheetRowTitle, isDark && s.textDark]}>{skill.name}</Text>
                  {skill.description && (
                    <Text style={[s.sheetRowBody, isDark && s.labelDark]} numberOfLines={2}>
                      {skill.description}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Per-role model picker, reusing the chat one so a role's model is
          chosen exactly the way a session's is. */}
      <ModelPicker
        sheetRef={modelSheetRef}
        providers={pickableProviders}
        selected={
          modelForIndex !== null && roles[modelForIndex]?.providerID && roles[modelForIndex]?.modelID
            ? { providerID: roles[modelForIndex].providerID!, modelID: roles[modelForIndex].modelID! }
            : null
        }
        isDark={isDark}
        onSelect={pickModel}
      />
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  content: { padding: 16, gap: 8 },
  label: { fontSize: 11, fontWeight: "700", color: "#888888", letterSpacing: 0.5 },
  labelDark: { color: "#9a9a9a" },
  textDark: { color: "#ffffff" },
  input: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: "#0a0a0a",
  },
  inputDark: { borderColor: "#222", color: "#ffffff" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  addLink: { fontSize: 13, fontWeight: "600", color: "#6d28d9" },
  hint: { fontSize: 13, color: "#888888", lineHeight: 19 },
  roleCard: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 8,
  },
  roleCardDark: { borderColor: "#222" },
  roleHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  roleName: { flex: 1, fontSize: 15, fontWeight: "600", color: "#0a0a0a" },
  skillChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: "#ede9fe",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  skillChipText: { fontSize: 10, fontWeight: "600", color: "#6d28d9" },
  instructions: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    minHeight: 64,
    textAlignVertical: "top",
    color: "#0a0a0a",
  },
  modelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "#f5f3ff",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  modelBtnEmpty: { backgroundColor: "#fef3c7" },
  modelBtnText: { fontSize: 12, fontWeight: "600", color: "#6d28d9" },
  modelBtnTextEmpty: { color: "#b45309" },
  addBlank: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d4d4d4",
    marginTop: 8,
  },
  addBlankDark: { borderColor: "#333" },
  addBlankText: { fontSize: 13, color: "#666666" },
  blocker: { fontSize: 13, color: "#b45309", marginTop: 8 },
  headerAction: { fontSize: 16, fontWeight: "600", color: "#6d28d9" },
  headerActionMuted: { color: "#999999" },
  errorBar: { backgroundColor: "#fee2e2", padding: 10, borderRadius: 8 },
  errorText: { color: "#b91c1c", fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: "75%",
  },
  // A sheet that slides from the bottom needs to look draggable, or it reads
  // as content that happens to be cut off.
  sheetGrabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d4d4d4",
    marginBottom: 12,
  },
  sheetDark: { backgroundColor: "#111111" },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: "#0a0a0a", marginBottom: 4 },
  sheetScroll: { flexGrow: 0 },
  sheetRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5e5" },
  sheetRowTitle: { fontSize: 15, fontWeight: "600", color: "#0a0a0a" },
  sheetRowBody: { fontSize: 13, color: "#666666", marginTop: 3, lineHeight: 18 },
})
