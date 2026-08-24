import { useEffect, useState } from "react"
import { StyleSheet, Text, useWindowDimensions, View } from "react-native"
import { Stack } from "expo-router"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { useAnimatedStyle, useSharedValue, withSpring, runOnJS } from "react-native-reanimated"
import { useViewer } from "../src/stores/viewer"

const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2.5

/**
 * Full-screen image viewer, pushed onto the navigation stack — back (button
 * or gesture) pops it like any screen; the staged URI (see
 * src/stores/viewer.ts — data: URIs are megabytes, not route-param material)
 * is dropped on unmount.
 *
 * Zoom is real on BOTH platforms: the first version used ScrollView's
 * maximumZoomScale, which silently does nothing on Android — the only
 * platform this app's users actually hold. Pinch + pan + double-tap run on
 * the UI thread via RNGH/reanimated, the same native-arbitration stack that
 * won the sideways-table fight: pan only engages while zoomed, so at rest
 * the back-gesture and the stack own the edges.
 */
export default function ImageViewerScreen() {
  const image = useViewer((s) => s.image)
  const { width, height } = useWindowDimensions()

  useEffect(() => {
    return () => useViewer.getState().clearImage()
  }, [])

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  // JS-side mirror of "zoomed", used to enable pan: at scale 1 the pan
  // gesture must not exist at all or it eats the back-gesture and list
  // arbitration (the PanResponder lesson, learned once already).
  const [zoomed, setZoomed] = useState(false)

  const clampOffsets = (nextScale: number) => {
    "worklet"
    const maxX = (width * (nextScale - 1)) / 2
    const maxY = (height * (nextScale - 1)) / 2
    tx.value = withSpring(Math.min(maxX, Math.max(-maxX, tx.value)), { damping: 20 })
    ty.value = withSpring(Math.min(maxY, Math.max(-maxY, ty.value)), { damping: 20 })
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale))
    })
    .onEnd(() => {
      savedScale.value = scale.value
      if (scale.value <= 1.02) {
        scale.value = withSpring(1, { damping: 20 })
        savedScale.value = 1
        tx.value = withSpring(0, { damping: 20 })
        ty.value = withSpring(0, { damping: 20 })
        runOnJS(setZoomed)(false)
      } else {
        clampOffsets(scale.value)
        runOnJS(setZoomed)(true)
      }
    })

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onStart(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })
    .onEnd(() => {
      clampOffsets(scale.value)
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.02) {
        scale.value = withSpring(1, { damping: 20 })
        savedScale.value = 1
        tx.value = withSpring(0, { damping: 20 })
        ty.value = withSpring(0, { damping: 20 })
        runOnJS(setZoomed)(false)
      } else {
        scale.value = withSpring(DOUBLE_TAP_SCALE, { damping: 20 })
        savedScale.value = DOUBLE_TAP_SCALE
        runOnJS(setZoomed)(true)
      }
    })

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan))

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  return (
    <>
      <Stack.Screen
        options={{
          title: image?.filename || "Image",
          headerStyle: { backgroundColor: "#000000" },
          headerTintColor: "#ffffff",
        }}
      />
      <View style={s.container}>
        {image ? (
          <GestureDetector gesture={gesture}>
            <Animated.Image
              source={{ uri: image.uri }}
              style={[s.image, animatedStyle]}
              resizeMode="contain"
              testID="image-viewer-image"
            />
          </GestureDetector>
        ) : (
          // Deep-linked here without staged content (e.g. state restore
          // after process death) — degrade, don't render a broken frame.
          <Text style={s.missing}>This image is no longer available.</Text>
        )}
      </View>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  missing: { color: "#9a9a9a", textAlign: "center", fontSize: 14 },
})
