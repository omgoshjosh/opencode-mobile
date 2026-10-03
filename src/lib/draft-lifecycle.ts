// Draft work belongs only to the visible composer. The focus-time empty value
// must wait for restoration, but actual typed input must survive a blur before
// that read settles.
export function shouldPersistFocusedDraft(
  focused: boolean,
  restored: boolean,
  touched: boolean,
  savedText: string | undefined,
  inputText: string,
): boolean {
  return focused && (restored || touched) && savedText !== inputText
}

/** A keystroke that wins the storage race must never be replaced by a draft. */
export function shouldApplyRestoredDraft(focused: boolean, touched: boolean): boolean {
  return focused && !touched
}

// ---------------------------------------------------------------------------
// Autosave (#55): "one second debounce to save draft while typing".
//
// Typing schedules a save of exactly (sessionID, text) after ~1 s of quiet.
// Blur, backgrounding, session change, navigation and unmount call `flush()`
// so nothing pending waits on the timer. Each pending save carries its own
// session, so switching sessions flushes A into A and can never write into B.
//
// A sent message stops being a draft only once the server has ACCEPTED it
// (the 2xx from POST /session/:id/prompt_async, or the awaited command or
// summarize call). `beginSend` makes the draft durable for the flight and
// returns the (sessionID, text) it captured; `accepted` clears the draft only
// if it still holds that exact text, so anything typed during the flight is
// kept. A failed send never calls `accepted`, so the draft stays.
//
// Kill / OS eviction is best effort: at most the last ~1 s of typing (one
// debounce window) can be lost, plus whatever AsyncStorage had not flushed.
// It is not a crash guarantee.
// ---------------------------------------------------------------------------

export const DRAFT_SAVE_DEBOUNCE_MS = 1000

export interface DraftSendToken {
  sessionID: string
  text: string
}

export interface DraftAutosaveDeps {
  /** Persist (or, for blank text, delete) one session's draft. */
  save: (sessionID: string, text: string) => void
  /** The draft text currently persisted for a session. */
  stored: (sessionID: string) => string | undefined
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createDraftAutosave(deps: DraftAutosaveDeps) {
  const delay = deps.delayMs ?? DRAFT_SAVE_DEBOUNCE_MS
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let pending: { sessionID: string; text: string; timer: unknown } | null = null

  const flush = () => {
    if (!pending) return
    const { sessionID, text, timer } = pending
    pending = null
    clearTimer(timer)
    deps.save(sessionID, text)
  }

  const discard = (sessionID: string, text?: string) => {
    if (!pending || pending.sessionID !== sessionID || (text !== undefined && pending.text !== text)) return
    clearTimer(pending.timer)
    pending = null
  }

  return {
    /** A keystroke: save this session's text after the debounce. */
    change(sessionID: string, text: string) {
      if (pending && pending.sessionID !== sessionID) flush()
      if (pending) clearTimer(pending.timer)
      const entry: { sessionID: string; text: string; timer: unknown } = { sessionID, text, timer: undefined }
      entry.timer = setTimer(() => {
        if (pending === entry) flush()
      }, delay)
      pending = entry
    },
    /** Blur, background, session change, navigation, unmount. */
    flush,
    /** The send starts: the draft must be durable until the server accepts it. */
    beginSend(sessionID: string, text: string): DraftSendToken {
      flush()
      if (deps.stored(sessionID) !== text) deps.save(sessionID, text)
      return { sessionID, text }
    },
    /** The server accepted the send. Clears only the text that was sent. */
    accepted(token: DraftSendToken) {
      discard(token.sessionID, token.text)
      if (deps.stored(token.sessionID) === token.text) deps.save(token.sessionID, "")
    },
  }
}

export type DraftAutosave = ReturnType<typeof createDraftAutosave>
