import { useEffect, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList } from "@gorhom/bottom-sheet"
import { formatElapsed } from "../../lib/elapsed-format"
import type { BackgroundJob } from "../../lib/background-activity"

export function BackgroundJobsSheet({ sheetRef, jobs, isDark, onOpen }: { sheetRef: React.RefObject<BottomSheet | null>; jobs: BackgroundJob[]; isDark: boolean; onOpen: (job: BackgroundJob) => void }) {
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  return <BottomSheet ref={sheetRef} index={-1} onChange={(index) => setOpen(index >= 0)} snapPoints={["45%"]} enableDynamicSizing={false} enablePanDownToClose backgroundStyle={isDark ? s.dark : s.sheet} backdropComponent={(props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />}>
    <Text style={[s.title, isDark && s.white]}>Working</Text>
    <BottomSheetFlatList data={jobs} keyExtractor={(job: BackgroundJob) => job.sessionID} renderItem={({ item }: { item: BackgroundJob }) => <TouchableOpacity style={s.row} onPress={() => onOpen(item)} accessibilityLabel={`${item.title}, ${item.role}, working`}>
      <View style={s.copy}><Text style={[s.job, isDark && s.white]} numberOfLines={1}>{item.title}</Text><Text style={[s.meta, isDark && s.dim]}>{item.role} · {formatElapsed(Math.max(0, now - item.since))} · working</Text></View>
    </TouchableOpacity>} />
  </BottomSheet>
}

const s = StyleSheet.create({ sheet: { backgroundColor: "#fff" }, dark: { backgroundColor: "#141420" }, title: { fontSize: 17, fontWeight: "700", color: "#0a0a0a", padding: 20 }, row: { minHeight: 56, paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#e5e5e5", justifyContent: "center" }, copy: { gap: 3 }, job: { fontSize: 15, fontWeight: "600", color: "#0a0a0a" }, meta: { fontSize: 12, color: "#666" }, white: { color: "#fff" }, dim: { color: "#aaa" } })
