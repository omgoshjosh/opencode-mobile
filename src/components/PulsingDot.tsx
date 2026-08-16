import { useEffect } from "react"
import { View, StyleSheet, type ViewStyle } from "react-native"
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated"

/**
 * A dot that breathes while something is running.
 *
 * The session list distinguishes busy from idle with a static coloured badge,
 * which answers "what state is this in" but not "is it still moving". On a
 * list of 30-odd sessions, a run that has silently stalled looks exactly like
 * one making progress. Motion is the cheapest signal that separates them.
 *
 * Deliberately opacity-only: it does not touch layout, so it can live inside a
 * FlatList row without triggering re-measure on every frame. Reanimated drives
 * it on the UI thread, so a busy JS thread — which is exactly when sessions
 * are streaming — cannot stutter it.
 */
export function PulsingDot({
  color = "#16a34a",
  size = 6,
  active = true,
  style,
}: {
  color?: string
  size?: number
  active?: boolean
  style?: ViewStyle
}) {
  const opacity = useSharedValue(1)

  useEffect(() => {
    if (!active) {
      // Leave it fully visible rather than mid-fade: a stopped animation
      // frozen at 0.35 opacity reads as a rendering bug.
      cancelAnimation(opacity)
      opacity.value = 1
      return
    }
    opacity.value = withRepeat(
      withTiming(0.25, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1, // forever
      true, // reverse, so it breathes rather than blinking back to full
    )
    return () => cancelAnimation(opacity)
  }, [active])

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }))

  if (!active) {
    return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />
  }

  return (
    <Animated.View
      style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, animated, style]}
    />
  )
}

const styles = StyleSheet.create({
  dot: { alignSelf: "center" },
})
