import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type {
  AdminAnnouncementDTO,
  AnnouncementReaderDTO,
  UserAnnouncementDTO,
} from '@shared/types/api'
import type { AnnouncementPhase } from '@shared/types/domain'
import type { AnnouncementCreateInput, AnnouncementUpdateInput } from '@shared/schemas/announcement'
import { db } from '../db/client'
import { announcementReads, announcements, users } from '../db/schema'
import type { AuthUser } from '../http/types'

type AnnouncementRow = typeof announcements.$inferSelect

/** status + 生效窗口派生的运行态（不落库，读取时计算）。 */
function derivePhase(row: AnnouncementRow, now: number): AnnouncementPhase {
  if (row.status !== 'published') return 'draft'
  if (row.publishAt != null && row.publishAt.getTime() > now) return 'scheduled'
  if (row.expiresAt != null && row.expiresAt.getTime() <= now) return 'expired'
  return 'active'
}

/** 目标受众总人数：all=全部用户，admins=管理员数。 */
async function audienceCounts(): Promise<{ all: number; admins: number }> {
  const [all] = await db.select({ c: sql<number>`count(*)` }).from(users)
  const [admins] = await db
    .select({ c: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, 'admin'))
  return { all: all?.c ?? 0, admins: admins?.c ?? 0 }
}

function toAdminDTO(
  row: AnnouncementRow,
  readCount: number,
  audienceCount: number,
  createdByName: string | null,
  now: number,
): AdminAnnouncementDTO {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    channel: row.channel,
    audience: row.audience,
    status: row.status,
    pinned: row.pinned,
    maxImpressions: row.maxImpressions,
    publishAt: row.publishAt?.getTime() ?? null,
    expiresAt: row.expiresAt?.getTime() ?? null,
    createdByName,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    phase: derivePhase(row, now),
    readCount,
    audienceCount,
  }
}

/** 管理端：列出全部公告（含派生运行态、已读人数、受众人数、创建者名）。 */
export async function listAdminAnnouncements(): Promise<AdminAnnouncementDTO[]> {
  const rows = await db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
  if (rows.length === 0) return []

  // 每条公告的已读人数（仅统计已确认，即 readAt 非空）
  const readRows = await db
    .select({ aid: announcementReads.announcementId, c: sql<number>`count(*)` })
    .from(announcementReads)
    .where(isNotNull(announcementReads.readAt))
    .groupBy(announcementReads.announcementId)
  const readMap = new Map(readRows.map((r) => [r.aid, r.c]))

  // 创建者用户名（仅查用到的 id）
  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v))]
  const creatorRows = creatorIds.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, creatorIds))
    : []
  const creatorMap = new Map(creatorRows.map((r) => [r.id, r.username]))

  const counts = await audienceCounts()
  const now = Date.now()
  return rows.map((row) =>
    toAdminDTO(
      row,
      readMap.get(row.id) ?? 0,
      row.audience === 'admins' ? counts.admins : counts.all,
      row.createdBy ? (creatorMap.get(row.createdBy) ?? null) : null,
      now,
    ),
  )
}

/** 管理端：取单条（附统计），不存在返回 null。 */
export async function getAdminAnnouncement(id: string): Promise<AdminAnnouncementDTO | null> {
  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
  if (!row) return null
  const [read] = await db
    .select({ c: sql<number>`count(*)` })
    .from(announcementReads)
    .where(and(eq(announcementReads.announcementId, id), isNotNull(announcementReads.readAt)))
  const counts = await audienceCounts()
  let createdByName: string | null = null
  if (row.createdBy) {
    const [u] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, row.createdBy))
      .limit(1)
    createdByName = u?.username ?? null
  }
  return toAdminDTO(
    row,
    read?.c ?? 0,
    row.audience === 'admins' ? counts.admins : counts.all,
    createdByName,
    Date.now(),
  )
}

/** 管理端：创建公告。 */
export async function createAnnouncement(
  input: AnnouncementCreateInput,
  createdBy: string,
): Promise<AdminAnnouncementDTO> {
  const [row] = await db
    .insert(announcements)
    .values({
      title: input.title,
      body: input.body,
      level: input.level,
      channel: input.channel,
      audience: input.audience,
      status: input.status,
      pinned: input.pinned,
      maxImpressions: input.maxImpressions,
      publishAt: input.publishAt != null ? new Date(input.publishAt) : null,
      expiresAt: input.expiresAt != null ? new Date(input.expiresAt) : null,
      createdBy,
    })
    .returning()
  const counts = await audienceCounts()
  return toAdminDTO(
    row!,
    0,
    row!.audience === 'admins' ? counts.admins : counts.all,
    null,
    Date.now(),
  )
}

/** 管理端：更新公告（部分补丁）。不存在返回 null。 */
export async function updateAnnouncement(
  id: string,
  patch: AnnouncementUpdateInput,
): Promise<AdminAnnouncementDTO | null> {
  const [existing] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
  if (!existing) return null
  const set: Partial<typeof announcements.$inferInsert> = { updatedAt: new Date() }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.body !== undefined) set.body = patch.body
  if (patch.level !== undefined) set.level = patch.level
  if (patch.channel !== undefined) set.channel = patch.channel
  if (patch.audience !== undefined) set.audience = patch.audience
  if (patch.status !== undefined) set.status = patch.status
  if (patch.pinned !== undefined) set.pinned = patch.pinned
  if (patch.maxImpressions !== undefined) set.maxImpressions = patch.maxImpressions
  if (patch.publishAt !== undefined) set.publishAt = patch.publishAt != null ? new Date(patch.publishAt) : null
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt != null ? new Date(patch.expiresAt) : null
  await db.update(announcements).set(set).where(eq(announcements.id, id))
  return getAdminAnnouncement(id)
}

/** 管理端：删除公告（已读回执随 FK 级联删除）。 */
export async function deleteAnnouncement(id: string): Promise<void> {
  await db.delete(announcements).where(eq(announcements.id, id))
}

/** 生效窗口 + 受众 的可见性条件（读取时计算，无 cron）。 */
function visibleConds(user: AuthUser, now: Date) {
  const conds = [
    eq(announcements.status, 'published'),
    or(isNull(announcements.publishAt), lte(announcements.publishAt, now)),
    or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
  ]
  // 管理员可见 all + admins；普通用户仅 all。
  if (user.role !== 'admin') conds.push(eq(announcements.audience, 'all'))
  return and(...conds)
}

/** 用户端：列出当前对该用户生效的公告（含是否已读），置顶优先、按时间倒序。 */
export async function listActiveForUser(user: AuthUser): Promise<UserAnnouncementDTO[]> {
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      level: announcements.level,
      channel: announcements.channel,
      pinned: announcements.pinned,
      maxImpressions: announcements.maxImpressions,
      publishAt: announcements.publishAt,
      createdAt: announcements.createdAt,
      readAt: announcementReads.readAt,
      impressions: announcementReads.impressions,
    })
    .from(announcements)
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.announcementId, announcements.id),
        eq(announcementReads.userId, user.id),
      ),
    )
    .where(visibleConds(user, new Date()))
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    level: r.level,
    channel: r.channel,
    pinned: r.pinned,
    publishAt: r.publishAt?.getTime() ?? null,
    createdAt: r.createdAt.getTime(),
    read: r.readAt != null,
    maxImpressions: r.maxImpressions,
    impressions: r.impressions ?? 0,
  }))
}

/** 用户端：标记某条公告已读/已确认（幂等 upsert）。返回该公告是否存在。 */
export async function markAnnouncementRead(id: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1)
  if (!row) return false
  const now = new Date()
  await db
    .insert(announcementReads)
    .values({ announcementId: id, userId, readAt: now })
    .onConflictDoUpdate({
      target: [announcementReads.announcementId, announcementReads.userId],
      set: { readAt: now },
    })
  return true
}

/** 用户端：把当前所有生效公告标记为已读（幂等 upsert）。返回本次新标记的条数。 */
export async function markAllAnnouncementsRead(user: AuthUser): Promise<number> {
  const active = await listActiveForUser(user)
  const unread = active.filter((a) => !a.read)
  if (unread.length === 0) return 0
  const now = new Date()
  for (const a of unread) {
    await db
      .insert(announcementReads)
      .values({ announcementId: a.id, userId: user.id, readAt: now })
      .onConflictDoUpdate({
        target: [announcementReads.announcementId, announcementReads.userId],
        set: { readAt: now },
      })
  }
  return unread.length
}

/**
 * 用户端：记录一次强弹窗曝光（幂等 upsert，impressions+1）。
 * 不改动 readAt。返回该公告是否存在。
 */
export async function recordAnnouncementImpression(id: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1)
  if (!row) return false
  await db
    .insert(announcementReads)
    .values({ announcementId: id, userId, impressions: 1 })
    .onConflictDoUpdate({
      target: [announcementReads.announcementId, announcementReads.userId],
      set: { impressions: sql`${announcementReads.impressions} + 1` },
    })
  return true
}

/**
 * 管理端：重置某条公告的全部已读/曝光记录（清空该公告的所有回执行）。
 * 之后该公告对所有受众重新变为「未读、曝光归零」，会再次推送。返回是否存在。
 */
export async function resetAnnouncementReads(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1)
  if (!row) return false
  await db.delete(announcementReads).where(eq(announcementReads.announcementId, id))
  return true
}

/** 管理端：列出已确认（已读）该公告的用户名单，按已读时间倒序。 */
export async function listAnnouncementReaders(id: string): Promise<AnnouncementReaderDTO[]> {
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      readAt: announcementReads.readAt,
    })
    .from(announcementReads)
    .innerJoin(users, eq(users.id, announcementReads.userId))
    .where(and(eq(announcementReads.announcementId, id), isNotNull(announcementReads.readAt)))
    .orderBy(desc(announcementReads.readAt))
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    readAt: r.readAt!.getTime(),
  }))
}
