import { useQuery } from '@tanstack/react-query'
import { getConversation, listConversations } from '../api/chat'

export function useConversations() {
  return useQuery({ queryKey: ['conversations'], queryFn: listConversations })
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => getConversation(id as string),
    enabled: Boolean(id),
  })
}
