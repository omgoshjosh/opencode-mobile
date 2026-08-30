const stubs = {
  zustand: `
    export const create = (initializer) => {
      let state
      const set = (update) => { state = { ...state, ...(typeof update === "function" ? update(state) : update) } }
      const get = () => state
      state = initializer(set, get)
      const store = (selector = (value) => value) => selector(state)
      store.getState = get
      store.setState = set
      return store
    }
  `,
  "./connections": `export const useConnections = globalThis.__eventReconnectConnections`,
  "./sessions": `export const useSessions = globalThis.__eventReconnectSessions; export const abortedSessions = new Set(); export const optimisticSendingRevision = () => 0; export const optimisticSendingRevisionSnapshot = () => new Map();`,
  "../lib/focus-read": `export const canRefreshPending = () => true`,
  "../lib/notifications": `export const send = () => {}`,
  "../lib/notify-format": `export const sanitizeBody = (_, fallback) => fallback`,
  "../lib/status-labels": `export const statusFromPart = () => ""`,
  "../lib/sentry": `export const addBreadcrumb = () => {}`,
  "../lib/analytics": `export const AnalyticsEvent = {}; export const track = () => {}`,
  "../lib/store-review": `export const recordSuccessfulSession = () => {}`,
  "../lib/api-error": `export const isAuthError = () => false`,
  "../lib/session-status-reconcile": `export const isSessionActuallyIdle = () => false`,
  "../lib/status-cache": `export const parseStatusCache = () => ({}); export const toStatusCache = (value) => value`,
  "../lib/busy-lifecycle": `export const nextSessionStatus = (_, next) => next; export const noteTextActivity = (value) => value`,
  "../lib/background-activity": `export const mergeStatusEvent = (_, next) => next; export const mergeStatusSnapshot = (_, next) => next`,
  "../lib/status-hydration": `export const canApplyFocusedStatusHydration = () => true; export const canApplyResyncIdle = () => true; export const canApplyStatusHydration = () => true; export const clearIdleSessionState = ({ sending, runningTools }) => ({ sending, runningTools }); export const settledIdleSessionIDs = () => []`,
  "@react-native-async-storage/async-storage": `export default { getItem: async () => null, setItem: async () => {} }`,
  "../lib/sse-liveness": `export const isHealthy = () => true; export const shouldReconnectOnResume = () => true; export const shouldResetRetries = () => true`,
}

export async function resolve(specifier, context, nextResolve) {
  const source = stubs[specifier]
  if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  return nextResolve(specifier, context)
}
