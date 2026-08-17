import { memo, useState } from "react"
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { Markdown } from "../markdown"
import { ToolCallCard } from "./ToolCallCard"
import { ReasoningBlock } from "./ReasoningBlock"
import { SelectableTextModal } from "./SelectableTextModal"
import { splitSwarmBriefing } from "../../lib/swarm-briefing"
import type { Message, Part } from "../../lib/sdk"
import { useCatalog } from "../../stores/catalog"
import { modelDisplayLabel } from "../../lib/model-label"
import { deliveryState } from "../../lib/message-delivery"
import { useSessions } from "../../stores/sessions"

const SCREEN_WIDTH = Dimensions.get("window").width

function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith("image/")
}

interface Props {
  message: Message
  parts: Part[]
  isDark: boolean
  // Long-press opens the message action sheet. For user messages that sheet
  // offers "Edit message" / revert; for both roles it offers copy and
  // select-text (the only copy path assistant prose has — see
  // src/lib/message-copy-text.ts). Identified by messageID (not a closure
  // over parts) so it stays correct even if the memo below bails on a stale
  // render.
  onLongPress?: (messageID: string) => void
}

// TODO: Replace with streamdown-rn once React 19 types PR lands - it has
// built-in block-level memoization that eliminates re-renders for stable blocks
export const MessageBubble = memo(
  function MessageBubble({ message, parts, isDark, onLongPress }: Props) {
    const isUser = message.role === "user"

    // Resolve display names from the provider catalog so a swarm shows its
    // team name rather than its opaque swm_... handle. Read from the store
    // rather than threaded through props: the label depends on *this*
    // message's model, so a single parent-computed value would not do, and a
    // per-bubble `providers` prop would have to join the memo comparator for
    // every row.
    const providers = useCatalog((c) => c.providers)
    const failedMessageIDs = useSessions((st) => st.failedMessageIDs)
    // "sent" is the overwhelmingly common case and needs no chrome; only the
    // in-flight and failed states are worth a badge.
    const delivery = deliveryState({ messageID: message.id, failedIDs: failedMessageIDs })
    const userModelLabel = message.model
      ? modelDisplayLabel(providers, { providerID: message.model.providerID, modelID: message.model.modelID })
      : null
    const assistantModelLabel =
      !isUser && message.providerID && message.modelID
        ? modelDisplayLabel(providers, { providerID: message.providerID, modelID: message.modelID })
        : message.modelID || null

    const textParts = parts.filter((p) => p.type === "text")
    const reasoningParts = parts.filter((p) => p.type === "reasoning")
    const toolParts = parts.filter((p) => p.type === "tool")
    const fileParts = parts.filter((p) => p.type === "file" && isImageMime(p.mime))
    const joined = textParts.map((p) => p.text).join("\n") || ""
    // Swarm sessions attach the orchestrator briefing (~4.5KB of roster and
    // rules) to the user's message as a text part. It is context for the
    // model, not for the human rereading their own message — collapse it to a
    // small indicator, expandable on demand. See src/lib/swarm-briefing.ts.
    const { visibleText: text, briefing, swarmName } = splitSwarmBriefing(joined)
    const [showBriefing, setShowBriefing] = useState(false)
    const reasoning = reasoningParts.map((p) => p.text).join("\n") || ""

    return (
      <TouchableOpacity
        activeOpacity={onLongPress ? 0.7 : 1}
        onLongPress={onLongPress ? () => onLongPress(message.id) : undefined}
        disabled={!onLongPress}
        style={[
          s.bubble,
          isUser ? s.user : s.assistant,
          isUser && isDark && s.userDark,
          !isUser && isDark && s.assistantDark,
        ]}
        testID={`chat-bubble-${message.role}`}
      >
        {/* Role indicator */}
        <View style={s.header}>
          <Ionicons
            name={isUser ? "person" : "sparkles"}
            size={14}
            color={isUser ? (isDark ? "#ffffff" : "#0a0a0a") : "#8b5cf6"}
          />
          <Text style={[s.role, isUser && s.roleUser, isDark && s.textWhite]}>{isUser ? "You" : "Assistant"}</Text>
          {userModelLabel && <Text style={[s.modelTag, isDark && s.modelTagDark]}>{userModelLabel}</Text>}
          {delivery !== "sent" && (
            <Text style={[s.deliveryTag, delivery === "failed" ? s.deliveryFailed : s.deliveryQueued]}>
              {delivery === "failed" ? "Failed" : "Queued"}
            </Text>
          )}
          {!isUser && assistantModelLabel && (
            <Text style={[s.modelTag, isDark && s.modelTagDark]}>{assistantModelLabel}</Text>
          )}
        </View>

        {/* Image attachments */}
        {fileParts.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.imageRow}
            style={s.imageScroll}
          >
            {fileParts.map((fp) => (
              <View key={fp.id} style={s.imageWrap}>
                <Image source={{ uri: fp.url }} style={s.attachedImage} resizeMode="cover" />
                {fp.filename && (
                  <Text style={[s.imageLabel, isDark && s.imageLabelDark]} numberOfLines={1}>
                    {fp.filename}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        )}

        {/* Reasoning (collapsible) */}
        {reasoning.length > 0 && <ReasoningBlock text={reasoning} isDark={isDark} />}

        {/* Message text */}
        {text.length > 0 &&
          (isUser ? (
            <Text style={[s.messageText, isDark && s.textWhite]} selectable>
              {text}
            </Text>
          ) : (
            <View style={s.markdownWrap}>
              <Markdown>{text}</Markdown>
            </View>
          ))}

        {/* Collapsed swarm briefing. Indicated, not shown: the name says
            where the message went; the tap keeps the detail reachable. */}
        {briefing && (
          <TouchableOpacity
            style={[s.briefingChip, isDark && s.briefingChipDark]}
            onPress={() => setShowBriefing(true)}
            activeOpacity={0.7}
            testID="swarm-briefing-chip"
          >
            <Ionicons name="people-outline" size={12} color="#6d28d9" />
            <Text style={s.briefingChipText} numberOfLines={1}>
              Swarm briefing{swarmName ? ` · ${swarmName}` : ""}
            </Text>
            <Ionicons name="chevron-forward" size={12} color="#8b5cf6" />
          </TouchableOpacity>
        )}
        {briefing && (
          <SelectableTextModal visible={showBriefing} text={briefing} onClose={() => setShowBriefing(false)} />
        )}

        {/* Tool calls */}
        {toolParts.map((tool) => (
          <ToolCallCard key={tool.id} tool={tool} isDark={isDark} />
        ))}

        {/* Tokens/cost for assistant messages */}
        {!isUser && message.tokens && (
          <Text style={[s.tokens, isDark && s.tokensDark]}>
            {message.tokens.input + message.tokens.output} tokens
            {message.cost ? ` · $${message.cost.toFixed(4)}` : ""}
          </Text>
        )}
      </TouchableOpacity>
    )
  },
  (prev, next) => {
    // Only re-render if message content actually changed
    // This prevents completed messages from re-rendering during streaming.
    // The store replaces changed parts/messages with NEW object references,
    // so a reference-equality sweep over every part catches every real change
    // (including tool parts, which have no `.text`) while still skipping
    // unchanged (completed) messages during other messages' streaming.
    if (prev.message !== next.message) return false
    if (prev.isDark !== next.isDark) return false
    if (prev.onLongPress !== next.onLongPress) return false
    if (prev.parts.length !== next.parts.length) return false
    for (let i = 0; i < prev.parts.length; i++) {
      if (prev.parts[i] !== next.parts[i]) return false
    }
    return true
  },
)

const s = StyleSheet.create({
  briefingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "#f5f3ff",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  briefingChipDark: { backgroundColor: "#2e1065" },
  briefingChipText: { fontSize: 11, fontWeight: "600", color: "#6d28d9", flexShrink: 1 },
  bubble: { marginBottom: 16, padding: 12, borderRadius: 12, maxWidth: "100%" },
  user: { backgroundColor: "#f5f5f5", marginLeft: 32 },
  userDark: { backgroundColor: "#1a1a1a" },
  assistant: { backgroundColor: "#f0f0ff" },
  assistantDark: { backgroundColor: "#1a1a2e" },

  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  role: { fontSize: 13, fontWeight: "600", color: "#666666" },
  roleUser: { color: "#0a0a0a" },
  textWhite: { color: "#ffffff" },

  modelTag: {
    fontSize: 11,
    color: "#999999",
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  modelTagDark: { backgroundColor: "#2a2a2a", color: "#888888" },

  deliveryTag: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  deliveryQueued: { backgroundColor: "#fef3c7", color: "#92400e" },
  deliveryFailed: { backgroundColor: "#fee2e2", color: "#b91c1c" },

  messageText: { fontSize: 15, lineHeight: 22, color: "#0a0a0a" },
  markdownWrap: { marginHorizontal: -4 },

  tokens: { fontSize: 11, color: "#999999", marginTop: 8 },
  tokensDark: { color: "#666666" },

  // Images
  imageScroll: { marginBottom: 8 },
  imageRow: { gap: 8 },
  imageWrap: { alignItems: "center" },
  attachedImage: {
    width: Math.min(200, SCREEN_WIDTH * 0.5),
    height: Math.min(200, SCREEN_WIDTH * 0.5),
    borderRadius: 8,
    backgroundColor: "#e5e5e5",
  },
  imageLabel: { fontSize: 10, color: "#666666", marginTop: 2, maxWidth: 200 },
  imageLabelDark: { color: "#888888" },
})
