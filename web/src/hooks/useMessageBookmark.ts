import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConversationDetail } from '@shared/types/api'
import { bookmarkMessage } from '../api/chat'
import { toast } from '../store/toast'

export function useMessageBookmark(conversationId: string) {
  const queryClient = useQueryClient()
  const queryKey = ['conversation', conversationId]
  const updateBookmark = (messageId: string, bookmarked: boolean) => {
    queryClient.setQueryData<ConversationDetail>(
      queryKey,
      (detail) =>
        detail && {
          ...detail,
          messages: detail.messages.map((message) =>
            message.id === messageId ? { ...message, bookmarked } : message,
          ),
        },
    )
  }
  return useMutation({
    mutationFn: ({ messageId, bookmarked }: { messageId: string; bookmarked: boolean }) =>
      bookmarkMessage(conversationId, messageId, bookmarked),
    onMutate: async ({ messageId, bookmarked }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous =
        queryClient
          .getQueryData<ConversationDetail>(queryKey)
          ?.messages.find((message) => message.id === messageId)?.bookmarked ?? false
      updateBookmark(messageId, bookmarked)
      return previous
    },
    onError: (_error, { messageId }, previous) => {
      // 只回滚收藏字段，保留请求期间流式生成或分支更新写入的消息。
      updateBookmark(messageId, previous ?? false)
      toast.error('收藏未能保存，请重试')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}
