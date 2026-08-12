import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { sessions, users } from '../db/schema'

/**
 * 原子替换密码状态并撤销该用户的全部会话。
 * 管理员重置、强制改密和用户自助改密共用同一条安全边界，避免出现密码已换但旧会话仍存活。
 */
export function replacePasswordAndRevokeSessions(
  userId: string,
  passwordHash: string,
  mustChangePassword: boolean,
): boolean {
  return db.transaction(
    (tx) => {
      const updated = tx
        .update(users)
        .set({ passwordHash, mustChangePassword })
        .where(eq(users.id, userId))
        .returning({ id: users.id })
        .get()
      if (!updated) return false
      tx.delete(sessions).where(eq(sessions.userId, userId)).run()
      return true
    },
    { behavior: 'immediate' },
  )
}
