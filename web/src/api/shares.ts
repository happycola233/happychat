import type { QueryClient } from '@tanstack/react-query'
import type { PublicShareDTO, SharedChatDTO } from '@shared/types/api'
import type { CreateShareInput } from '@shared/schemas/share'
import { apiDelete, apiGet, apiPost } from './client'

/**
 * 分享状态分散在弹窗（conversation-share）、设置页（my-shares）、管理后台（admin shares）
 * 三个缓存视图里；任何创建/更新/撤销后统一从这里失效，避免视图间状态漂移。
 */
export function invalidateShareQueries(qc: QueryClient, conversationId?: string) {
  void qc.invalidateQueries({ queryKey: ['my-shares'] })
  void qc.invalidateQueries({
    queryKey: conversationId ? ['conversation-share', conversationId] : ['conversation-share'],
  })
  void qc.invalidateQueries({ queryKey: ['admin', 'shares'] })
}

/** 未撤销但已过到期时间：链接当前不可访问。 */
export function isShareExpired(share: Pick<SharedChatDTO, 'expiresAt'>): boolean {
  return share.expiresAt !== null && share.expiresAt < Date.now()
}

// ---- 公开分享 ----
export const getPublicShare = (token: string) =>
  apiGet<{ share: PublicShareDTO }>(`/shares/${token}`).then((r) => r.share)

export const shareAttachmentUrl = (token: string, attachmentId: string) =>
  `/api/shares/${token}/attachments/${attachmentId}`

// ---- 会话分享管理（属主）----
export const createShare = (conversationId: string, input: CreateShareInput) =>
  apiPost<{ share: SharedChatDTO }>(`/conversations/${conversationId}/share`, input).then(
    (r) => r.share,
  )

export const getConversationShare = (conversationId: string) =>
  apiGet<{ share: SharedChatDTO | null }>(`/conversations/${conversationId}/share`).then(
    (r) => r.share,
  )

export const revokeConversationShare = (conversationId: string) =>
  apiDelete<{ ok: true }>(`/conversations/${conversationId}/share`)

export const listMyShares = () =>
  apiGet<{ shares: SharedChatDTO[] }>('/conversations/shared').then((r) => r.shares)

export const listAllShares = () =>
  apiGet<{ shares: SharedChatDTO[] }>('/admin/shares').then((r) => r.shares)

export const adminRevokeShare = (id: string) => apiPost<{ ok: true }>(`/admin/shares/${id}/revoke`)
