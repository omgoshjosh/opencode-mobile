import { useEffect } from "react"
import { View, Image, ScrollView, StyleSheet, Text } from "react-native"
import { Stack } from "expo-router"
import { useViewer } from "../src/stores/viewer"

/**
 * Full-screen image viewer, pushed onto the navigation stack — so it behaves
 * like every other screen: back (button or gesture) pops it, nothing modal
 * to dismiss, no overlay states to manage. The image itself is staged in the
 * viewer store (see src/stores/viewer.ts — data: URIs are megabytes and do
 * not belong in route params) and the reference is dropped on unmount.
 *
 * Zoom: ScrollView's native pinch-zoom where the platform provides it (iOS);
 * a gesture-based zoom for Android is a later refinement — the common case
 * this exists for is "let me actually SEE the screenshot", which fit-to-
 * screen already answers.
 */
export default function ImageViewerScreen() {
  const image = useViewer((s) => s.image)

  useEffect(() => {
    return () => useViewer.getState().clearImage()
  }, [])

  return (
    <>
      <Stack.Screen
        options={{
          title: image?.filename || "Image",
          headerStyle: { backgroundColor: "#000000" },
          headerTintColor: "#ffffff",
        }}
      />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        maximumZoomScale={5}
        minimumZoomScale={1}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        {image ? (
          <Image source={{ uri: image.uri }} style={s.image} resizeMode="contain" testID="image-viewer-image" />
        ) : (
          // Deep-linked here without staged content (e.g. state restore
          // after process death) — degrade, don't render a broken frame.
          <Text style={s.missing}>This image is no longer available.</Text>
        )}
      </ScrollView>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  content: { flexGrow: 1, justifyContent: "center" },
  image: { width: "100%", height: "100%", minHeight: 300 },
  missing: { color: "#9a9a9a", textAlign: "center", fontSize: 14 },
})
