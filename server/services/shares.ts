import { and, desc, eq } from 'drizzle-orm'
import type { CreateShareInput } from '@shared/schemas/share'
import type { MessageDTO, PublicShareDTO, SharedChatDTO } from '@shared/types/api'
import type { ContentPart } from '@shared/types/domain'
import { resolveSelectionChain } from '@shared/util/shareSelection'
import { getUserAvatarUrl } from '../auth/users'
import { db } from '../db/client'
import { attachments, conversations, sharedChats, users } from '../db/schema'
import { genShareToken } from '../lib/id'
import { buildPath, getConversationMessageDTOs, getConversationMessages } from './conversations'
import { getAppConfig } from './appConfig'

type ShareRow = typeof sharedChats.$inferSelect
type AttachmentRow = typeof attachments.$inferSelect

export interface ShareUser {
  canShare: boolean | null
}

/** 该用户当前是否可分享：全局开关 && 用户级覆盖（null=随全局）。 */
export async function canUserShare(user: ShareUser): Promise<boolean> {
  const cfg = await getAppConfig()
  if (!cfg.sharingEnabled) return false
  return user.canShare ?? true
}

function toShareDTO(row: ShareRow, ownerUsername?: string): SharedChatDTO {
  return {
    id: row.id,
    token: row.token,
    conversationId: row.conversationId,
    title: row.title,
    showAvatar: row.showAvatar,
    showName: row.showName,
    includeAttachments: row.includeAttachments,
    messageCount: row.snapshot.length,
    expiresAt: row.expiresAt?.getTime() ?? null,
    revoked: row.revoked,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    ...(ownerUsername ? { ownerUsername } : {}),
  }
}

function expiryFromDays(days: number | null): Date | null {
  return days ? new Date(Date.now() + days * 86_400_000) : null
}

/** 用户上传的附件部件（分享可选择排除；模型生成的 image_result 属于回复内容，始终保留）。 */
function isUserAttachmentPart(p: ContentPart): p is Extract<ContentPart, { type: 'input_image' | 'input_file' }> {
  return p.type === 'input_image' || p.type === 'input_file'
}

/**
 * 剥离快照中用户上传附件的引用：attachment_id 置空，文件保留文件名供占位展示。
 * 剥离后公开附件路由天然取不到 id，无需额外判断即实现“不包含附件”。
 */
function stripUserAttachments(snapshot: MessageDTO[]): MessageDTO[] {
  return snapshot.map((m) => ({
    ...m,
    content: m.content.map((p) => (isUserAttachmentPart(p) ? { ...p, attachment_id: '' } : p)),
  }))
}

/**
 * 构建快照。selectedIds 为 null 时取当前可见路径全部消息；
 * 否则校验选中集必须落在同一条分支链上，返回按链序截取的子集；非法返回 null。
 */
async function buildSnapshot(
  conversationId: string,
  activeLeafId: string | null,
  selectedIds: string[] | null,
): Promise<MessageDTO[] | null> {
  const dtos = await getConversationMessageDTOs(conversationId)
  const byId = new Map(dtos.map((d) => [d.id, d]))
  const all = await getConversationMessages(conversationId)

  if (!selectedIds) {
    return buildPath(all, activeLeafId)
      .map((m) => byId.get(m.id))
      .filter((d): d is MessageDTO => Boolean(d))
  }

  const orderedIds = resolveSelectionChain(
    all.map((m) => ({ id: m.id, parentId: m.parentId })),
    selectedIds,
  )
  if (!orderedIds) return null
  return orderedIds.map((id) => byId.get(id)).filter((d): d is MessageDTO => Boolean(d))
}

/** 创建/更新某会话的分享（一会话一条；重复分享刷新快照与设置）。 */
export async function createShare(
  userId: string,
  conversationId: string,
  input: CreateShareInput,
): Promise<
  { ok: true; share: SharedChatDTO } | { ok: false; code: 'not_found' | 'invalid_selection' }
> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1)
  if (!conv) return { ok: false, code: 'not_found' }

  const rawSnapshot = await buildSnapshot(conversationId, conv.activeLeafId, input.messageIds ?? null)
  if (!rawSnapshot || rawSnapshot.length === 0) return { ok: false, code: 'invalid_selection' }
  const snapshot = input.includeAttachments ? rawSnapshot : stripUserAttachments(rawSnapshot)

  const [existing] = await db
    .select()
    .from(sharedChats)
    .where(eq(sharedChats.conversationId, conversationId))
    .limit(1)

  if (existing) {
    // 'keep'/缺省 = 保持现有到期时间不变（修复：以前每次更新都会被重置成永久）。
    const expiresAt =
      input.expiresInDays === 'keep' || input.expiresInDays === undefined
        ? existing.expiresAt
        : expiryFromDays(input.expiresInDays)
    const [updated] = await db
      .update(sharedChats)
      .set({
        snapshot,
        title: conv.title,
        showAvatar: input.showAvatar,
        showName: input.showName,
        includeAttachments: input.includeAttachments,
        expiresAt,
        revoked: false,
        // 「停止分享」后再次分享必须换新 token：旧链接永久失效，拿到旧链接的人看不到新内容。
        ...(existing.revoked ? { token: genShareToken(), createdAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(sharedChats.id, existing.id))
      .returning()
    return { ok: true, share: toShareDTO(updated!) }
  }

  const expiresAt =
    input.expiresInDays === 'keep' || input.expiresInDays === undefined
      ? null
      : expiryFromDays(input.expiresInDays)
  const [created] = await db
    .insert(sharedChats)
    .values({
      token: genShareToken(),
      conversationId,
      ownerId: userId,
      title: conv.title,
      snapshot,
      showAvatar: input.showAvatar,
      showName: input.showName,
      includeAttachments: input.includeAttachments,
      expiresAt,
    })
    .returning()
  return { ok: true, share: toShareDTO(created!) }
}

/** 取某会话当前分享（属于该用户，未撤销）。 */
export async function getConversationShare(
  userId: string,
  conversationId: string,
): Promise<SharedChatDTO | null> {
  const [row] = await db
    .select()
    .from(sharedChats)
    .where(
      and(
        eq(sharedChats.conversationId, conversationId),
        eq(sharedChats.ownerId, userId),
        eq(sharedChats.revoked, false),
      ),
    )
    .limit(1)
  if (!row) return null
  // 附带快照内消息 id，供分享弹窗回显“上次分享了哪些消息”。
  return { ...toShareDTO(row), sharedMessageIds: row.snapshot.map((m) => m.id) }
}

export async function listOwnerShares(userId: string): Promise<SharedChatDTO[]> {
  const rows = await db
    .select()
    .from(sharedChats)
    .where(and(eq(sharedChats.ownerId, userId), eq(sharedChats.revoked, false)))
    .orderBy(desc(sharedChats.createdAt))
  return rows.map((r) => toShareDTO(r))
}

/** 撤销分享（软删除：链接失效，仍可被管理员审计）。owner=null 时按管理员撤销。 */
export async function revokeShare(shareId: string, ownerId: string | null): Promise<boolean> {
  const cond = ownerId
    ? and(eq(sharedChats.id, shareId), eq(sharedChats.ownerId, ownerId))
    : eq(sharedChats.id, shareId)
  const rows = await db.update(sharedChats).set({ revoked: true }).where(cond).returning()
  return rows.length > 0
}

function isLive(row: ShareRow): boolean {
  if (row.revoked) return false
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false
  return true
}

/** 公开分享视图（按 token，无需登录）。 */
export async function getPublicShare(token: string): Promise<PublicShareDTO | null> {
  const [row] = await db.select().from(sharedChats).where(eq(sharedChats.token, token)).limit(1)
  if (!row || !isLive(row)) return null

  let owner: PublicShareDTO['owner'] = { name: null, avatarUrl: null }
  if (row.showName || row.showAvatar) {
    const [u] = await db.select().from(users).where(eq(users.id, row.ownerId)).limit(1)
    if (u) {
      owner = {
        name: row.showName ? (u.displayName || u.username) : null,
        avatarUrl: row.showAvatar ? getUserAvatarUrl(u) : null,
      }
    }
  }
  return {
    title: row.title,
    messages: row.snapshot,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    attachmentsIncluded: row.includeAttachments,
    owner,
  }
}

/** 公开分享内的附件读取：校验该附件确实出现在快照可见路径中。 */
export async function getShareAttachment(
  token: string,
  attachmentId: string,
): Promise<AttachmentRow | null> {
  const [row] = await db.select().from(sharedChats).where(eq(sharedChats.token, token)).limit(1)
  if (!row || !isLive(row)) return null
  const ids = new Set<string>()
  for (const m of row.snapshot) {
    for (const p of m.content) {
      // 剥离附件后的快照中 attachment_id 为空串，天然不会进入白名单。
      if ('attachment_id' in p && typeof p.attachment_id === 'string' && p.attachment_id) {
        ids.add(p.attachment_id)
      }
    }
  }
  if (!ids.has(attachmentId)) return null
  const [a] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1)
  return a ?? null
}

/** 管理端：列出全部分享（含拥有者用户名）。 */
export async function listAllShares(): Promise<SharedChatDTO[]> {
  const rows = await db
    .select({ s: sharedChats, username: users.username })
    .from(sharedChats)
    .innerJoin(users, eq(sharedChats.ownerId, users.id))
    .orderBy(desc(sharedChats.createdAt))
  return rows.map(({ s, username }) => toShareDTO(s, username))
}
