import { create } from 'zustand'
import type { LiveMessage, LiveStatus } from '../sse/eventReducer'

const COMPLETION_NOTICE_DURATION_MS = 7000
const MAX_VISIBLE_COMPLETION_NOTICES = 4
const COMPLETION_PREVIEW_MAX_CHARACTERS = 120

export type ConversationActivityState = 'generating' | 'unread'

export const conversationActivityLabel = (state: ConversationActivityState): string =>
  state === 'generating' ? '正在生成回复' : '有未查看的新回复'

export interface ConversationCompletionNotice {
  /** run id 天然唯一，同时用于终态回放去重。 */
  id: string
  runId: string
  conversationId: string
  title: string
  message: string
}

interface ConversationActivityStore {
  /** 值为最后一次尚未查看的完成 run id；状态只在当前浏览器会话内存在。 */
  unreadRunByConversation: Record<string, string>
  completionNotices: ConversationCompletionNotice[]
  recordBackgroundCompletion: (notice: ConversationCompletionNotice) => void
  updateConversationTitle: (conversationId: string, title: string) => void
  markViewed: (conversationId: string) => void
  dismissNotice: (noticeId: string) => void
  reset: () => void
}

/** 截断按 Unicode code point 计数，避免把 emoji 或代理对切成乱码。 */
export function compactActivityText(text: string, maxCharacters: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  const characters = Array.from(singleLine)
  if (characters.length <= maxCharacters) return singleLine
  return `${characters.slice(0, Math.max(0, maxCharacters - 1)).join('')}…`
}

/** 失败、主动取消和连接中断不应伪装成“回复已生成”。 */
export function isNotifiableCompletionStatus(status: LiveStatus): boolean {
  return status === 'completed' || status === 'incomplete'
}

export function shouldRecordBackgroundCompletion({
  currentConversationId,
  conversationId,
  runId,
  stream,
}: {
  currentConversationId: string | undefined
  conversationId: string
  runId: string
  stream: ({ runId: string } & Pick<LiveMessage, 'status'>) | undefined
}): boolean {
  return (
    currentConversationId !== conversationId &&
    stream?.runId === runId &&
    isNotifiableCompletionStatus(stream.status)
  )
}

export function completionPreviewFromStream(
  stream: Pick<LiveMessage, 'text' | 'imageGenerations'>,
): string {
  const textPreview = compactActivityText(stream.text, COMPLETION_PREVIEW_MAX_CHARACTERS)
  if (textPreview) return textPreview

  const completedImageCount = stream.imageGenerations.filter(
    (generation) => generation.status === 'done' && Boolean(generation.attachmentId),
  ).length
  if (completedImageCount === 1) return '图片已生成'
  if (completedImageCount > 1) return `已生成 ${completedImageCount} 张图片`
  return '回复已生成'
}

export const useConversationActivityStore = create<ConversationActivityStore>((set, get) => ({
  unreadRunByConversation: {},
  completionNotices: [],
  recordBackgroundCompletion: (notice) => {
    let recorded = false
    set((state) => {
      const alreadyRecorded =
        state.unreadRunByConversation[notice.conversationId] === notice.runId ||
        state.completionNotices.some((item) => item.runId === notice.runId)
      if (alreadyRecorded) return state

      recorded = true
      return {
        unreadRunByConversation: {
          ...state.unreadRunByConversation,
          [notice.conversationId]: notice.runId,
        },
        completionNotices: [...state.completionNotices, notice].slice(
          -MAX_VISIBLE_COMPLETION_NOTICES,
        ),
      }
    })

    if (!recorded) return
    globalThis.setTimeout(() => get().dismissNotice(notice.id), COMPLETION_NOTICE_DURATION_MS)
  },
  updateConversationTitle: (conversationId, title) =>
    set((state) => {
      const normalizedTitle = title.trim()
      if (
        !normalizedTitle ||
        !state.completionNotices.some(
          (notice) => notice.conversationId === conversationId && notice.title !== normalizedTitle,
        )
      ) {
        return state
      }

      return {
        completionNotices: state.completionNotices.map((notice) =>
          notice.conversationId === conversationId ? { ...notice, title: normalizedTitle } : notice,
        ),
      }
    }),
  markViewed: (conversationId) =>
    set((state) => {
      const hasUnread = Object.prototype.hasOwnProperty.call(
        state.unreadRunByConversation,
        conversationId,
      )
      const hasNotice = state.completionNotices.some(
        (notice) => notice.conversationId === conversationId,
      )
      if (!hasUnread && !hasNotice) return state

      const unreadRunByConversation = { ...state.unreadRunByConversation }
      delete unreadRunByConversation[conversationId]
      return {
        unreadRunByConversation,
        completionNotices: state.completionNotices.filter(
          (notice) => notice.conversationId !== conversationId,
        ),
      }
    }),
  dismissNotice: (noticeId) =>
    set((state) => {
      if (!state.completionNotices.some((notice) => notice.id === noticeId)) return state
      return {
        completionNotices: state.completionNotices.filter((notice) => notice.id !== noticeId),
      }
    }),
  reset: () => set({ unreadRunByConversation: {}, completionNotices: [] }),
}))
