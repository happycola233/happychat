import { and, eq, exists, gt, isNull, lte, or } from 'drizzle-orm'
import { db } from '../db/client'
import { announcements, announcementUserTargets } from '../db/schema'
import type { AuthUser } from '../http/types'

/** 正文与图片共用生效窗口及受众边界；用户端不会因管理员身份自动获得公告。 */
export function announcementVisibleCondition(user: AuthUser, now: Date) {
  return and(
    eq(announcements.status, 'published'),
    or(isNull(announcements.publishAt), lte(announcements.publishAt, now)),
    or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
    or(
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
                eq(announcementUserTargets.userId, user.id),
              ),
            ),
        ),
      ),
    ),
  )
}
