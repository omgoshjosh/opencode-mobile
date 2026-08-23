import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

/**
 * Tripwire for the "poisoned persistent memory" class of bug (a scanner
 * flagged us for it; see the triage in the security notes).
 *
 * The app is a thin client: sessions, messages and tool output live on the
 * opencode server and are held in memory by the zustand stores. Nothing that
 * a model or a tool produced is ever written to on-device storage, so there
 * is no persistent store an injected instruction could sit in and be replayed
 * from on the next launch.
 *
 * That property is worth keeping, and it is invisible in review: it only
 * breaks the day someone adds a well-meaning "cache the last conversation" or
 * "remember the assistant's summary" write. So: every on-device write is
 * enumerated here by key. Adding a new one is fine — you just have to come
 * to this list and say what it holds, which is the moment to ask whether the
 * value is user/config data or model output.
 *
 * Rule: keys listed here must hold user-entered config, consent flags or
 * counters. Never message text, session titles, tool results or any other
 * model-derived content.
 */
const ALLOWED_PERSISTED_KEYS = new Map<string, string>([
  ["SETTINGS_KEY", "user's app settings (theme, notification prefs)"],
  ["CONNECTIONS_KEY", "user-entered server connections"],
  ["`${PASSWORDS_PREFIX}${id}`", "user-entered server password, per connection"],
  ["RECENT_DIRS_KEY", "directories the user picked, for the recents list"],
  ["AUTH_SETTINGS_KEY", "biometric/app-lock preference"],
  ["COUNT_KEY", "store-review: launch counter"],
  ["ASKED_KEY", "store-review: already-prompted flag"],
  ["FIRST_OPEN_KEY", "analytics: first-open flag"],
  ["CONSENT_KEY", "telemetry consent decision"],
  ["CHATWOOT_SOURCE_KEY", "support contact id issued by Chatwoot"],
])

/**
 * The same rule for AsyncStorage.
 *
 * This half was missing: the scan below only ever looked at SecureStore, so
 * every AsyncStorage write — the larger and less guarded of the two APIs —
 * went unreviewed. Anything cached there is exactly as replayable into next
 * launch's context as a SecureStore value, so it needs the same enumeration.
 */
const ALLOWED_ASYNC_KEYS = new Map<string, string>([
  ["GROUP_MODE_KEY", "sessions list: chosen group-by mode"],
  ["DISMISSED_KEY", "update banner: version the user dismissed"],
  ["LAST_VIEWED_KEY", "sessionID -> last-opened timestamp; ids and numbers only, no content"],
  ["SESSION_FILTER_KEY", "sessions list: hide-subagents flag + chosen status names"],
  ["DRAFTS_KEY", "composer drafts: the user's own half-typed prompts, per session; never model output"],
  ["STATUS_CACHE_KEY", "last-known busy sessions for cold-start list rendering; ids and a type tag only"],
  ["PREVIEWS_KEY", "one truncated preview line per session for the list; bounded by MAX_TRACKED_PREVIEWS"],
  [
    "SESSIONS_SNAPSHOT_KEY",
    // Same review outcome as PREVIEWS_KEY: session titles are model-derived,
    // but the snapshot is rendered as inert list text with a visible "as of"
    // label and is never fed into any model, prompt or request. revert/share
    // state is stripped before writing (src/lib/list-freshness.ts) so stale
    // versions can't drive an action against the wrong message.
    "sessions-list metadata snapshot (ids, titles, timestamps, directories) for cold-start paint; bounded by SNAPSHOT_MAX_SESSIONS",
  ],
  ["SESSION_SORT_KEY", "sessions list: chosen sort order (a fixed enum string)"],
  // These two write through a variable rather than a literal, so the key is
  // named at the call site's own constant. Listed by the variable name their
  // helpers use; both hold queued user-submitted form data, not model output.
  ["key", "update-check / waitlist-queue: caller-supplied key, user data only"],
])

// Both source roots. `src` alone missed every write in `app/` — the screens,
// which are exactly where a "remember what the user was looking at" cache
// gets added. GROUP_MODE_KEY and SESSION_FILTER_KEY both live there and were
// unscanned until this was widened.
const ROOTS = [path.join(import.meta.dirname, ".."), path.join(import.meta.dirname, "..", "..", "app")].filter((dir) =>
  fs.existsSync(dir),
)

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (entry.name.includes(".test.")) return []
    return [full]
  })
}

test("every on-device write uses a reviewed key, never model-generated content", () => {
  const unknown: string[] = []

  for (const file of allSourceFiles()) {
    const code = fs.readFileSync(file, "utf8")
    for (const match of code.matchAll(/SecureStore\.setItemAsync\(\s*([^,]+?)\s*,/g)) {
      const key = match[1].trim()
      if (!ALLOWED_PERSISTED_KEYS.has(key)) unknown.push(`${file}: ${key}`)
    }
  }

  assert.deepEqual(
    unknown,
    [],
    `New persistent write(s) found. If the value is user config, add the key to ALLOWED_PERSISTED_KEYS ` +
      `with a note. If it is model or tool output, don't persist it — it comes back as context next launch:\n` +
      unknown.join("\n"),
  )
})

test("every AsyncStorage write uses a reviewed key too", () => {
  const unknown: string[] = []

  for (const file of allSourceFiles()) {
    const code = fs.readFileSync(file, "utf8")
    for (const match of code.matchAll(/AsyncStorage\.setItem\(\s*([^,]+?)\s*,/g)) {
      const key = match[1].trim()
      if (!ALLOWED_ASYNC_KEYS.has(key)) unknown.push(`${file}: ${key}`)
    }
  }

  assert.deepEqual(
    unknown,
    [],
    `New AsyncStorage write(s) found. Same rule as SecureStore: user config, consent flags and ` +
      `counters are fine; message text, titles and tool output are not — they come back as context ` +
      `next launch:\n` + unknown.join("\n"),
  )
})

function allSourceFiles(): string[] {
  return ROOTS.flatMap(sourceFiles)
}

test("the allowlist itself stays live (no keys left behind after a refactor)", () => {
  const code = allSourceFiles()
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n")
  const used = new Set(
    [...code.matchAll(/SecureStore\.setItemAsync\(\s*([^,]+?)\s*,/g)].map((match) => match[1].trim()),
  )
  const stale = [...ALLOWED_PERSISTED_KEYS.keys()].filter((key) => !used.has(key))

  assert.deepEqual(stale, [], `Allowlist entries no longer written anywhere — delete them:\n${stale.join("\n")}`)
})
