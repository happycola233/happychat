import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ContextAttachmentSelection } from '@shared/types/context'

interface ContextSelectionStore {
  byConversation: Record<string, ContextAttachmentSelection>
  revisions: Record<string, number>
  pending: Record<
    string,
    { conversationId: string; selection: ContextAttachmentSelection; revision: number }
  >
  set: (conversationId: string, selection: ContextAttachmentSelection) => void
  accept: (
    conversationId: string,
    runId: string,
    sent: ContextAttachmentSelection | undefined,
  ) => void
  finish: (runId: string, failed: boolean) => void
}

/** 一次性附件选择按聊天隔离，在当前浏览器会话中保留，刷新或切换聊天不会丢失。 */
export const useContextSelection = create<ContextSelectionStore>()(
  persist(
    (set) => ({
      byConversation: {},
      revisions: {},
      pending: {},
      set: (conversationId, selection) =>
        set((state) => ({
          byConversation: { ...state.byConversation, [conversationId]: selection },
          revisions: {
            ...state.revisions,
            [conversationId]: (state.revisions[conversationId] ?? 0) + 1,
          },
        })),
      accept: (conversationId, runId, sent) =>
        set((state) => {
          // 请求期间用户可能为下一次发送重新选图，迟到的成功响应不能清掉新选择。
          if (
            !sent ||
            JSON.stringify(state.byConversation[conversationId]) !== JSON.stringify(sent)
          )
            return state
          const remaining = { ...state.byConversation }
          delete remaining[conversationId]
          return {
            byConversation: remaining,
            pending: {
              ...state.pending,
              [runId]: {
                conversationId,
                selection: sent,
                revision: state.revisions[conversationId] ?? 0,
              },
            },
          }
        }),
      finish: (runId, failed) =>
        set((state) => {
          const previous = state.pending[runId]
          if (!previous) return state
          const pending = { ...state.pending }
          delete pending[runId]
          // 上游失败或中断时恢复本次选择；用户已作出的下一次调整保持优先。
          const restore =
            failed && (state.revisions[previous.conversationId] ?? 0) === previous.revision
          return {
            pending,
            ...(restore
              ? {
                  byConversation: {
                    ...state.byConversation,
                    [previous.conversationId]: previous.selection,
                  },
                }
              : {}),
          }
        }),
    }),
    {
      name: 'happychat-context-selection',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        byConversation: state.byConversation,
        revisions: state.revisions,
        pending: state.pending,
      }),
    },
  ),
)
