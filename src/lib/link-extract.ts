// Pulling links OUT of raw tool output instead of linkifying it.
//
// Raw bash output is not prose; inline linkification would restyle text that
// was never meant to carry formatting, and URL boundaries inside logs are
// guessy (trailing punctuation, quotes, ANSI residue). So the output stays
// exactly as produced — mono, selectable — and any URLs found are offered
// separately as tappable/copyable chips. The output is never modified.
//
// Pure, so boundary handling is testable under plain `node --test`.

/** Conservative: http(s) only. `ftp://`, bare domains and `www.` are guesses. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`\]\)]+/g

/** Punctuation that ends sentences/log lines but is rarely part of a URL. */
const TRAILING_JUNK = /[.,;:!?]+$/

/** Cap so a log that prints thousands of URLs cannot flood the UI. */
export const MAX_EXTRACTED_LINKS = 20

/**
 * Unique URLs in the text, in first-appearance order.
 *
 * Trailing sentence punctuation is stripped — "see https://x.dev." almost
 * always means the URL without the dot. A trailing slash or path is kept;
 * only end-of-clause punctuation is treated as junk.
 */
export function extractLinks(text: string | null | undefined): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_JUNK, "")
    if (url.length < 12) continue // "https://x.y" floor; shorter is noise
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= MAX_EXTRACTED_LINKS) break
  }

  return out
}
