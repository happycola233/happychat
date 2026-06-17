import { desc, eq, sql } from 'drizzle-orm'
import type {
  AdminUserDTO,
  ErrorLogDTO,
  InviteCodeDTO,
  StatsDTO,
  UsageLogDTO,
} from '@shared/types/api'
import { db } from '../db/client'
import {
  conversations,
  errorLogs,
  inviteCodes,
  messages,
  runs,
  usageLogs,
  users,
} from '../db/schema'

export async function listInvites(): Promise<InviteCodeDTO[]> {
  const rows = await db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt))
  return rows.map((i) => ({
    id: i.id,
    code: i.code,
    note: i.note,
    maxUses: i.maxUses,
    usedCount: i.usedCount,
    disabled: i.disabled,
    expiresAt: i.expiresAt?.getTime() ?? null,
    createdAt: i.createdAt.getTime(),
  }))
}

export async function listAdminUsers(): Promise<AdminUserDTO[]> {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt))
  const counts = await db
    .select({ uid: conversations.userId, c: sql<number>`count(*)` })
    .from(conversations)
    .groupBy(conversations.userId)
  const map = new Map(counts.map((r) => [r.uid, r.c]))
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    disabled: u.disabled,
    createdAt: u.createdAt.getTime(),
    lastActiveAt: u.lastActiveAt?.getTime() ?? null,
    conversationCount: map.get(u.id) ?? 0,
  }))
}

async function count(table: typeof users | typeof conversations | typeof messages | typeof runs | typeof errorLogs): Promise<number> {
  const [r] = await db.select({ c: sql<number>`count(*)` }).from(table)
  return r?.c ?? 0
}

export async function getStats(): Promise<StatsDTO> {
  const [tok] = await db
    .select({
      input: sql<number>`coalesce(sum(${usageLogs.inputTokens}),0)`,
      cached: sql<number>`coalesce(sum(${usageLogs.cachedTokens}),0)`,
      output: sql<number>`coalesce(sum(${usageLogs.outputTokens}),0)`,
      reasoning: sql<number>`coalesce(sum(${usageLogs.reasoningTokens}),0)`,
      image: sql<number>`coalesce(sum(${usageLogs.imageTokens}),0)`,
      total: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
    })
    .from(usageLogs)

  const byModel = await db
    .select({
      model: usageLogs.modelLabel,
      calls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
    })
    .from(usageLogs)
    .groupBy(usageLogs.modelLabel)
    .orderBy(desc(sql`count(*)`))
    .limit(20)

  const byUser = await db
    .select({
      username: users.username,
      calls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
    })
    .from(usageLogs)
    .innerJoin(users, eq(usageLogs.userId, users.id))
    .groupBy(users.username)
    .orderBy(desc(sql`count(*)`))
    .limit(20)

  return {
    totals: {
      users: await count(users),
      conversations: await count(conversations),
      messages: await count(messages),
      runs: await count(runs),
      errors: await count(errorLogs),
    },
    tokens: {
      input: tok?.input ?? 0,
      cached: tok?.cached ?? 0,
      output: tok?.output ?? 0,
      reasoning: tok?.reasoning ?? 0,
      image: tok?.image ?? 0,
      total: tok?.total ?? 0,
    },
    byModel: byModel.map((m) => ({ model: m.model ?? '未知', calls: m.calls, totalTokens: m.totalTokens })),
    byUser: byUser.map((u) => ({ username: u.username, calls: u.calls, totalTokens: u.totalTokens })),
  }
}

export async function listErrorLogs(limit = 100): Promise<ErrorLogDTO[]> {
  const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.createdAt)).limit(limit)
  return rows.map((e) => ({
    id: e.id,
    scope: e.scope,
    errorType: e.errorType,
    code: e.code,
    httpStatus: e.httpStatus,
    message: e.message,
    createdAt: e.createdAt.getTime(),
  }))
}

export async function listUsageLogs(limit = 100): Promise<UsageLogDTO[]> {
  const rows = await db.select().from(usageLogs).orderBy(desc(usageLogs.createdAt)).limit(limit)
  return rows.map((u) => ({
    id: u.id,
    modelLabel: u.modelLabel,
    providerLabel: u.providerLabel,
    inputTokens: u.inputTokens,
    cachedTokens: u.cachedTokens,
    outputTokens: u.outputTokens,
    reasoningTokens: u.reasoningTokens,
    totalTokens: u.totalTokens,
    success: u.success,
    errorType: u.errorType,
    createdAt: u.createdAt.getTime(),
  }))
}
