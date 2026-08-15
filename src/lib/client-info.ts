// Identity this client reports to the server.
//
// Two problems this solves, both hit for real:
//
//  1. The Settings screen hardcoded "1.0.0" — not the app's version, not its
//     build number, just a literal. So the one place a user would look to
//     answer "which build am I on?" actively misinformed them.
//  2. The server had no way to tell either. Requests carried only
//     Content-Type, the directory header and Basic auth, so a build could not
//     be identified from the server side even in principle — which made
//     "are you on the latest build?" unanswerable during debugging.
//
// `expo-application` reads the real values baked into the native package, so
// they cannot drift from what was actually shipped the way a hand-maintained
// constant does.
// No runtime imports: like the other pure helpers here, this stays testable
// under plain `node --test`. Reading the native values (expo-application) and
// the platform happens at the call sites, which are already RN-only.

export interface ClientInfo {
  /** versionName, e.g. "0.4.12". */
  version: string
  /** versionCode / build number, e.g. "29780534" — what actually identifies a build. */
  build: string
  platform: string
}

/** Normalize possibly-null native values into a complete ClientInfo. */
export function clientInfoFrom(input: {
  version?: string | null
  build?: string | null
  platform?: string | null
}): ClientInfo {
  return {
    version: input.version || "unknown",
    build: input.build || "unknown",
    platform: input.platform || "unknown",
  }
}

/** Compact, header-safe rendering: `opencode-mobile/0.4.12 (build 29780534; android)`. */
export function clientInfoHeader(info: ClientInfo): string {
  const safe = (value: string) => value.replace(/[^\x20-\x7E]/g, "").replace(/[;()]/g, "")
  return `opencode-mobile/${safe(info.version)} (build ${safe(info.build)}; ${safe(info.platform)})`
}

/** Human-readable for the Settings screen. */
export function clientInfoLabel(info: ClientInfo): string {
  return `${info.version} (build ${info.build})`
}
