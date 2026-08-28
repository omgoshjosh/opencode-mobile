// Draft work belongs only to the visible composer. Waiting for restoration
// also prevents an early keyboard event from replacing a persisted draft with
// this route's temporary empty input.
export function shouldPersistFocusedDraft(focused: boolean, restored: boolean, savedText: string | undefined, inputText: string): boolean {
  return focused && restored && savedText !== inputText
}
