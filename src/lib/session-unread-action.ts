// Which unread action a session row should offer, if any.
//
// Both row variants (SessionItem and SessionRowV2) must offer exactly the same
// action in the same place, and the rule has two halves that are easy to get
// subtly different in two hand-written menus: the label depends on the current
// mark, and the whole item disappears on a daemon that lacks the route.
//
// Hiding rather than disabling is deliberate. A greyed-out "Mark as unread"
// invites the user to wonder what they did wrong; an action that cannot work
// here should simply not be in the menu.

export type UnreadAction = "markUnread" | "markRead"

export function unreadActionFor(input: { marked: boolean; supported: boolean }): UnreadAction | null {
  if (!input.supported) return null
  return input.marked ? "markRead" : "markUnread"
}

/** The i18n key for an action, so both rows label it identically. */
export function unreadActionLabelKey(action: UnreadAction): string {
  return `sessionsList.actions.${action}`
}
