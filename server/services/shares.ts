import { and, desc, eq } from 'drizzle-orm'
import type { CreateShareInput, UpdateShareInput } from '@shared/schemas/share'
import type { MessageDTO, PublicShareDTO, SharedChatDTO } from '@shared/types/api'
import { getUserAvatarUrl } from '../auth/users'
import { db } from '../db/client'
import { attachments, conversations, sharedChats, users } from '../db/schema'
import { newId } from '../lib/id'
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
    expiresAt: row.expiresAt?.getTime() ?? null,
    revoked: row.revoked,
    createdAt: row.createdAt.getTime(),
    ...(ownerUsername ? { ownerUsername } : {}),
  }
}

function expiryFromDays(days: number | null | undefined): Date | null {
  return days ? new Date(Date.now() + days * 86_400_000) : null
}

/** 构建当前可见路径的消息快照（含计时）。 */
async function buildSnapshot(conversationId: string, activeLeafId: string | null): Promise<MessageDTO[]> {
  const dtos = await getConversationMessageDTOs(conversationId)
  const byId = new Map(dtos.map((d) => [d.id, d]))
  const all = await getConversationMessages(conversationId)
  return buildPath(all, activeLeafId)
    .map((m) => byId.get(m.id))
    .filter((d): d is MessageDTO => Boolean(d))
}

/** 创建/更新某会话的分享（一会话一条；重复分享刷新快照与设置）。 */
export async function createShare(
  userId: string,
  conversationId: string,
  input: CreateShareInput,
): Promise<{ ok: true; share: SharedChatDTO } | { ok: false; code: 'not_found' }> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1)
  if (!conv) return { ok: false, code: 'not_found' }

  const snapshot = await buildSnapshot(conversationId, conv.activeLeafId)
  const expiresAt = expiryFromDays(input.expiresInDays)

  const [existing] = await db
    .select()
    .from(sharedChats)
    .where(eq(sharedChats.conversationId, conversationId))
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(sharedChats)
      .set({
        snapshot,
        title: conv.title,
        showAvatar: input.showAvatar,
        showName: input.showName,
        expiresAt,
        revoked: false,
        updatedAt: new Date(),
      })
      .where(eq(sharedChats.id, existing.id))
      .returning()
    return { ok: true, share: toShareDTO(updated!) }
  }

  const [created] = await db
    .insert(sharedChats)
    .values({
      token: newId(),
      conversationId,
      ownerId: userId,
      title: conv.title,
      snapshot,
      showAvatar: input.showAvatar,
      showName: input.showName,
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
  return row ? toShareDTO(row) : null
}

export async function listOwnerShares(userId: string): Promise<SharedChatDTO[]> {
  const rows = await db
    .select()
    .from(sharedChats)
    .where(and(eq(sharedChats.ownerId, userId), eq(sharedChats.revoked, false)))
    .orderBy(desc(sharedChats.createdAt))
  return rows.map((r) => toShareDTO(r))
}

export async function updateShare(
  userId: string,
  shareId: string,
  input: UpdateShareInput,
): Promise<SharedChatDTO | null> {
  const [row] = await db
    .select()
    .from(sharedChats)
    .where(and(eq(sharedChats.id, shareId), eq(sharedChats.ownerId, userId)))
    .limit(1)
  if (!row) return null
  const set: Partial<typeof sharedChats.$inferInsert> = { updatedAt: new Date() }
  if (input.showAvatar !== undefined) set.showAvatar = input.showAvatar
  if (input.showName !== undefined) set.showName = input.showName
  if (input.expiresInDays !== undefined) set.expiresAt = expiryFromDays(input.expiresInDays)
  const [updated] = await db
    .update(sharedChats)
    .set(set)
    .where(eq(sharedChats.id, shareId))
    .returning()
  return updated ? toShareDTO(updated) : null
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
      if ('attachment_id' in p && typeof p.attachment_id === 'string') ids.add(p.attachment_id)
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
