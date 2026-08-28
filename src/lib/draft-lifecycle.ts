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
