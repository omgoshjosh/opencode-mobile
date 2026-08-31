import { ApiError } from "./api-error.ts"
import { nextCursorFrom, shouldRetryWithoutPartBudget, transcriptPageQuery } from "./message-page.ts"
import type { MessageWithParts } from "./sdk.ts"

type Response<T> = { body: T; headers: Headers }
type Request = <T>(path: string, options?: RequestInit, sampleLatency?: boolean) => Promise<Response<T>>

export function createMessageTransport(request: Request) {
  let supportsPartBudget = true

  return {
    message: async (sessionID: string, messageID: string, signal?: AbortSignal): Promise<MessageWithParts> =>
      (await request<MessageWithParts>(`/session/${sessionID}/message/${messageID}`, { signal })).body,

    messagesPage: async (
      sessionID: string,
      params: { limit: number; before?: string; renderBudget?: number; partBudget?: number },
      signal?: AbortSignal,
      options?: { sampleLatency?: boolean },
    ): Promise<{ items: MessageWithParts[]; nextCursor?: string }> => {
      const page = (partBudget = supportsPartBudget ? params.partBudget : undefined) =>
        request<MessageWithParts[]>(
          `/session/${sessionID}/message?${transcriptPageQuery({ ...params, partBudget })}`,
          { signal },
          options?.sampleLatency,
        )
      try {
        const { body, headers } = await page()
        return { items: body, nextCursor: nextCursorFrom(headers) }
      } catch (error) {
        if (!(error instanceof ApiError) || !shouldRetryWithoutPartBudget(error.status, supportsPartBudget ? params.partBudget : undefined)) throw error
        const { body, headers } = await request<MessageWithParts[]>(
          `/session/${sessionID}/message?${transcriptPageQuery({ ...params, partBudget: undefined })}`,
          { signal },
          false,
        )
        supportsPartBudget = false
        return { items: body, nextCursor: nextCursorFrom(headers) }
      }
    },
  }
}
