// When should the slash popover be on screen?
//
// The old trigger was `startsWith("/") && !includes(" ")` — the first space
// killed the popover, so "/review the auth flow" lost its affordance the
// moment arguments began, and there was no way to confirm which command
// you were about to run. The popover now survives arguments whenever the
// FIRST token is a known command; unknown first tokens keep the old
// behaviour (popover only while typing the command itself).
//
// Pure, so the trigger rules are testable under plain `node --test`.

export function slashPopoverQuery(input: string, triggers: readonly string[]): string | null {
  if (!input.startsWith("/")) return null
  const body = input.slice(1)
  const spaceAt = body.indexOf(" ")
  if (spaceAt === -1) return body
  const first = body.slice(0, spaceAt).toLowerCase()
  return triggers.some((t) => t.toLowerCase() === first) ? first : null
}
