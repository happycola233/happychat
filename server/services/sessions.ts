import { desc, eq } from 'drizzle-orm'
import type { AdminSessionDTO } from '@shared/types/api'
import { db } from '../db/client'
import { sessions, users } from '../db/schema'

export async function listSessions(userId?: string): Promise<AdminSessionDTO[]> {
  const rows = await db
    .select({ s: sessions, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(userId ? eq(sessions.userId, userId) : undefined)
    .orderBy(desc(sessions.createdAt))
  return rows.map(({ s, username }) => ({
    id: s.id,
    userId: s.userId,
    username,
    userAgent: s.userAgent,
    createdAt: s.createdAt.getTime(),
    expiresAt: s.expiresAt.getTime(),
  }))
}

export async function revokeSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}
