import { useEffect, useRef } from "react"
import { Animated, StyleSheet, Text, TouchableWithoutFeedback } from "react-native"

/** How long the peek stays before fading itself out. */
export const TITLE_PEEK_MS = 2500

/**
 * The session header truncates long titles and the header has no room to
 * give. Tapping the title unfurls the full text in this banner just below
 * the header; it dismisses itself after TITLE_PEEK_MS (or on tap), so it can
 * never squat over a streaming transcript.
 *
 * Deliberately an overlay, not a header change: no font shrinking, no
 * marquee, no layout shift — the header keeps its exact geometry.
 */
export function TitlePeek({
  title,
  visible,
  isDark,
  onDismiss,
}: {
  title: string
  visible: boolean
  isDark: boolean
  onDismiss: () => void
}) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    opacity.setValue(0)
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start()
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => onDismiss())
    }, TITLE_PEEK_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible) return null

  return (
    <TouchableWithoutFeedback onPress={onDismiss}>
      <Animated.View style={[s.banner, isDark && s.bannerDark, { opacity }]} testID="title-peek">
        <Text style={[s.text, isDark && s.textDark]}>{title}</Text>
      </Animated.View>
    </TouchableWithoutFeedback>
  )
}

const s = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    elevation: 6,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerDark: { backgroundColor: "#1a1a1a", borderBottomColor: "#2a2a2a" },
  text: { fontSize: 15, fontWeight: "600", lineHeight: 21, color: "#0a0a0a" },
  textDark: { color: "#ffffff" },
})
