import { and, desc, eq, exists, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type {
  AdminAnnouncementDTO,
  AnnouncementAudienceDTO,
  AnnouncementReaderDTO,
  UserAnnouncementDTO,
} from '@shared/types/api'
import type { AnnouncementPhase } from '@shared/types/domain'
import type { AnnouncementCreateInput, AnnouncementUpdateInput } from '@shared/schemas/announcement'
import { db } from '../db/client'
import { announcementReads, announcements, announcementUserTargets, users } from '../db/schema'
import type { AuthUser } from '../http/types'

type AnnouncementRow = typeof announcements.$inferSelect
const AUDIENCE_INSERT_BATCH_SIZE = 250

/** status + 生效窗口派生的运行态（不落库，读取时计算）。 */
function derivePhase(row: AnnouncementRow, now: number): AnnouncementPhase {
  if (row.status !== 'published') return 'draft'
  if (row.publishAt != null && row.publishAt.getTime() > now) return 'scheduled'
  if (row.expiresAt != null && row.expiresAt.getTime() <= now) return 'expired'
  return 'active'
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

/** all 按账号总数；selected 按仍存在的目标关联行计数。 */
async function getAudienceCount(row: AnnouncementRow): Promise<number> {
  const [count] =
    row.audience === 'all'
      ? await db.select({ c: sql<number>`count(*)` }).from(users)
      : await db
          .select({ c: sql<number>`count(*)` })
          .from(announcementUserTargets)
          .where(eq(announcementUserTargets.announcementId, row.id))
  return count?.c ?? 0
}

/** 已读统计始终按当前受众过滤，受众收窄后不会继续计入已移除账号。 */
async function getReadCount(id: string): Promise<number> {
  const [read] = await db
    .select({ c: sql<number>`count(*)` })
    .from(announcementReads)
    .innerJoin(announcements, eq(announcements.id, announcementReads.announcementId))
    .leftJoin(
      announcementUserTargets,
      and(
        eq(announcementUserTargets.announcementId, announcementReads.announcementId),
        eq(announcementUserTargets.userId, announcementReads.userId),
      ),
    )
    .where(
      and(
        eq(announcements.id, id),
        isNotNull(announcementReads.readAt),
        or(eq(announcements.audience, 'all'), isNotNull(announcementUserTargets.userId)),
      ),
    )
  return read?.c ?? 0
}

/** 管理端：列出全部公告（含派生运行态、已读人数、受众人数、创建者名）。 */
export async function listAdminAnnouncements(): Promise<AdminAnnouncementDTO[]> {
  const rows = await db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
  if (rows.length === 0) return []

  const readRows = await db
    .select({ aid: announcementReads.announcementId, c: sql<number>`count(*)` })
    .from(announcementReads)
    .innerJoin(announcements, eq(announcements.id, announcementReads.announcementId))
    .leftJoin(
      announcementUserTargets,
      and(
        eq(announcementUserTargets.announcementId, announcementReads.announcementId),
        eq(announcementUserTargets.userId, announcementReads.userId),
      ),
    )
    .where(
      and(
        isNotNull(announcementReads.readAt),
        or(eq(announcements.audience, 'all'), isNotNull(announcementUserTargets.userId)),
      ),
    )
    .groupBy(announcementReads.announcementId)
  const readCountByAnnouncement = new Map(readRows.map((row) => [row.aid, row.c]))

  const targetRows = await db
    .select({ aid: announcementUserTargets.announcementId, c: sql<number>`count(*)` })
    .from(announcementUserTargets)
    .groupBy(announcementUserTargets.announcementId)
  const targetCountByAnnouncement = new Map(targetRows.map((row) => [row.aid, row.c]))

  const [allUsers] = await db.select({ c: sql<number>`count(*)` }).from(users)
  const allUserCount = allUsers?.c ?? 0

  const creatorIds = [
    ...new Set(rows.map((row) => row.createdBy).filter((id): id is string => !!id)),
  ]
  const creatorRows = creatorIds.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, creatorIds))
    : []
  const creatorNameById = new Map(creatorRows.map((row) => [row.id, row.username]))

  const now = Date.now()
  return rows.map((row) =>
    toAdminDTO(
      row,
      readCountByAnnouncement.get(row.id) ?? 0,
      row.audience === 'all' ? allUserCount : (targetCountByAnnouncement.get(row.id) ?? 0),
      row.createdBy ? (creatorNameById.get(row.createdBy) ?? null) : null,
      now,
    ),
  )
}

/** 管理端：取单条（附统计），不存在返回 null。 */
export async function getAdminAnnouncement(id: string): Promise<AdminAnnouncementDTO | null> {
  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
  if (!row) return null

  let createdByName: string | null = null
  if (row.createdBy) {
    const [creator] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, row.createdBy))
      .limit(1)
    createdByName = creator?.username ?? null
  }
  return toAdminDTO(
    row,
    await getReadCount(id),
    await getAudienceCount(row),
    createdByName,
    Date.now(),
  )
}

/** 管理端：按需读取一条公告的完整目标用户 ID 列表。 */
export async function getAnnouncementAudience(id: string): Promise<AnnouncementAudienceDTO | null> {
  const [row] = await db
    .select({ audience: announcements.audience })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1)
  if (!row) return null
  if (row.audience === 'all') return { audience: 'all', userIds: [] }

  const targets = await db
    .select({ userId: announcementUserTargets.userId })
    .from(announcementUserTargets)
    .where(eq(announcementUserTargets.announcementId, id))
    .orderBy(announcementUserTargets.userId)
  return { audience: 'selected', userIds: targets.map((target) => target.userId) }
}

export type CreateAnnouncementResult =
  | { ok: true; announcement: AdminAnnouncementDTO }
  | { ok: false; code: 'empty_audience' }
  | { ok: false; code: 'unknown_users'; unknownUserIds: string[] }

/** 管理端：创建公告及精确受众，二者在同一个 IMMEDIATE 事务内写入。 */
export async function createAnnouncement(
  input: AnnouncementCreateInput,
  createdBy: string,
): Promise<CreateAnnouncementResult> {
  const result = db.transaction(
    (tx) => {
      const selectedUserIds = input.audience === 'selected' ? [...new Set(input.userIds)] : []
      if (input.audience === 'selected' && selectedUserIds.length === 0) {
        return { ok: false, code: 'empty_audience' } as const
      }

      const existingUserIds = new Set(
        selectedUserIds.length > 0
          ? tx
              .select({ id: users.id })
              .from(users)
              .all()
              .map((user) => user.id)
          : [],
      )
      const unknownUserIds = selectedUserIds.filter((userId) => !existingUserIds.has(userId))
      if (unknownUserIds.length > 0) {
        return { ok: false, code: 'unknown_users', unknownUserIds } as const
      }

      const row = tx
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
        .returning({ id: announcements.id })
        .get()
      if (!row) throw new Error('创建公告失败')

      for (let offset = 0; offset < selectedUserIds.length; offset += AUDIENCE_INSERT_BATCH_SIZE) {
        const batch = selectedUserIds.slice(offset, offset + AUDIENCE_INSERT_BATCH_SIZE)
        tx.insert(announcementUserTargets)
          .values(batch.map((userId) => ({ announcementId: row.id, userId })))
          .run()
      }
      return { ok: true, id: row.id } as const
    },
    { behavior: 'immediate' },
  )

  if (!result.ok) return result
  const announcement = await getAdminAnnouncement(result.id)
  if (!announcement) throw new Error('创建公告后读取失败')
  return { ok: true, announcement }
}

export type UpdateAnnouncementResult =
  | { ok: true; announcement: AdminAnnouncementDTO }
  | { ok: false; code: 'announcement_missing' }
  | { ok: false; code: 'empty_audience' }
  | { ok: false; code: 'unknown_users'; unknownUserIds: string[] }

/** 管理端：部分更新公告；受众名单使用原子全量替换语义。 */
export async function updateAnnouncement(
  id: string,
  patch: AnnouncementUpdateInput,
): Promise<UpdateAnnouncementResult> {
  const result = db.transaction(
    (tx) => {
      const existing = tx.select().from(announcements).where(eq(announcements.id, id)).get()
      if (!existing) return { ok: false, code: 'announcement_missing' } as const

      const audienceChanged = patch.audience !== undefined || patch.userIds !== undefined
      const nextAudience = patch.audience ?? existing.audience
      let selectedUserIds: string[] = []
      if (audienceChanged && nextAudience === 'selected') {
        selectedUserIds =
          patch.userIds !== undefined
            ? [...new Set(patch.userIds)]
            : tx
                .select({ userId: announcementUserTargets.userId })
                .from(announcementUserTargets)
                .where(eq(announcementUserTargets.announcementId, id))
                .all()
                .map((target) => target.userId)
        if (selectedUserIds.length === 0) return { ok: false, code: 'empty_audience' } as const

        const existingUserIds = new Set(
          tx
            .select({ id: users.id })
            .from(users)
            .all()
            .map((user) => user.id),
        )
        const unknownUserIds = selectedUserIds.filter((userId) => !existingUserIds.has(userId))
        if (unknownUserIds.length > 0) {
          return { ok: false, code: 'unknown_users', unknownUserIds } as const
        }
      }

      const set: Partial<typeof announcements.$inferInsert> = { updatedAt: new Date() }
      if (patch.title !== undefined) set.title = patch.title
      if (patch.body !== undefined) set.body = patch.body
      if (patch.level !== undefined) set.level = patch.level
      if (patch.channel !== undefined) set.channel = patch.channel
      if (audienceChanged) set.audience = nextAudience
      if (patch.status !== undefined) set.status = patch.status
      if (patch.pinned !== undefined) set.pinned = patch.pinned
      if (patch.maxImpressions !== undefined) set.maxImpressions = patch.maxImpressions
      if (patch.publishAt !== undefined) {
        set.publishAt = patch.publishAt != null ? new Date(patch.publishAt) : null
      }
      if (patch.expiresAt !== undefined) {
        set.expiresAt = patch.expiresAt != null ? new Date(patch.expiresAt) : null
      }
      tx.update(announcements).set(set).where(eq(announcements.id, id)).run()

      if (audienceChanged) {
        tx.delete(announcementUserTargets)
          .where(eq(announcementUserTargets.announcementId, id))
          .run()
        for (
          let offset = 0;
          offset < selectedUserIds.length;
          offset += AUDIENCE_INSERT_BATCH_SIZE
        ) {
          const batch = selectedUserIds.slice(offset, offset + AUDIENCE_INSERT_BATCH_SIZE)
          tx.insert(announcementUserTargets)
            .values(batch.map((userId) => ({ announcementId: id, userId })))
            .run()
        }
      }
      return { ok: true } as const
    },
    { behavior: 'immediate' },
  )

  if (!result.ok) return result
  const announcement = await getAdminAnnouncement(id)
  if (!announcement) return { ok: false, code: 'announcement_missing' }
  return { ok: true, announcement }
}

/** 管理端：删除公告（目标名单与已读回执随 FK 级联删除）。 */
export async function deleteAnnouncement(id: string): Promise<void> {
  await db.delete(announcements).where(eq(announcements.id, id))
}

/** 受众条件：全体用户，或 selected 名单中包含当前账号。管理员不隐式绕过。 */
function audienceVisibleCondition(userId: string) {
  return or(
    eq(announcements.audience, 'all'),
    and(
      eq(announcements.audience, 'selected'),
      exists(
        db
          .select({ userId: announcementUserTargets.userId })
          .from(announcementUserTargets)
          .where(
            and(
              eq(announcementUserTargets.announcementId, announcements.id),
              eq(announcementUserTargets.userId, userId),
            ),
          ),
      ),
    ),
  )
}

/** 生效窗口 + 精确受众的可见性条件（读取时计算，无 cron）。 */
function visibleCondition(user: AuthUser, now: Date) {
  return and(
    eq(announcements.status, 'published'),
    or(isNull(announcements.publishAt), lte(announcements.publishAt, now)),
    or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
    audienceVisibleCondition(user.id),
  )
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
    .where(visibleCondition(user, new Date()))
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    channel: row.channel,
    pinned: row.pinned,
    publishAt: row.publishAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    read: row.readAt != null,
    maxImpressions: row.maxImpressions,
    impressions: row.impressions ?? 0,
  }))
}

async function isAnnouncementVisibleToUser(id: string, user: AuthUser): Promise<boolean> {
  const [row] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(and(eq(announcements.id, id), visibleCondition(user, new Date())))
    .limit(1)
  return !!row
}

/** 用户端：标记当前可见公告已读/已确认（幂等 upsert）。 */
export async function markAnnouncementRead(id: string, user: AuthUser): Promise<boolean> {
  if (!(await isAnnouncementVisibleToUser(id, user))) return false
  const now = new Date()
  await db
    .insert(announcementReads)
    .values({ announcementId: id, userId: user.id, readAt: now })
    .onConflictDoUpdate({
      target: [announcementReads.announcementId, announcementReads.userId],
      set: { readAt: now },
    })
  return true
}

/** 用户端：把当前所有生效公告标记为已读（幂等 upsert）。 */
export async function markAllAnnouncementsRead(user: AuthUser): Promise<number> {
  const active = await listActiveForUser(user)
  const unread = active.filter((announcement) => !announcement.read)
  if (unread.length === 0) return 0
  const now = new Date()
  for (const announcement of unread) {
    await db
      .insert(announcementReads)
      .values({ announcementId: announcement.id, userId: user.id, readAt: now })
      .onConflictDoUpdate({
        target: [announcementReads.announcementId, announcementReads.userId],
        set: { readAt: now },
      })
  }
  return unread.length
}

/** 用户端：记录一次当前可见强弹窗曝光，不改动 readAt。 */
export async function recordAnnouncementImpression(id: string, user: AuthUser): Promise<boolean> {
  if (!(await isAnnouncementVisibleToUser(id, user))) return false
  await db
    .insert(announcementReads)
    .values({ announcementId: id, userId: user.id, impressions: 1 })
    .onConflictDoUpdate({
      target: [announcementReads.announcementId, announcementReads.userId],
      set: { impressions: sql`${announcementReads.impressions} + 1` },
    })
  return true
}

/** 管理端：清空一条公告的全部已读/曝光回执，使当前受众再次收到推送。 */
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

/** 管理端：列出当前受众中已确认该公告的用户，按已读时间倒序。 */
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
    .innerJoin(announcements, eq(announcements.id, announcementReads.announcementId))
    .leftJoin(
      announcementUserTargets,
      and(
        eq(announcementUserTargets.announcementId, announcementReads.announcementId),
        eq(announcementUserTargets.userId, announcementReads.userId),
      ),
    )
    .where(
      and(
        eq(announcements.id, id),
        isNotNull(announcementReads.readAt),
        or(eq(announcements.audience, 'all'), isNotNull(announcementUserTargets.userId)),
      ),
    )
    .orderBy(desc(announcementReads.readAt))
  return rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    readAt: row.readAt!.getTime(),
  }))
}
