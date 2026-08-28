export function requestSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  if (parent?.aborted) throw new Error("Request aborted")

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  parent?.addEventListener("abort", onAbort)

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout)
      parent?.removeEventListener("abort", onAbort)
    },
  }
}
