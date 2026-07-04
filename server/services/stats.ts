import { and, asc, desc, eq, gte, like, lte, sql, type SQL } from 'drizzle-orm'
import type {
  AnalyticsDTO,
  AnalyticsSeriesPoint,
  ErrorLogDTO,
  OverviewDTO,
  Paginated,
  UsageLogDTO,
  UserStatDTO,
} from '@shared/types/api'
import type { ModelPricing } from '@shared/types/domain'
import { costUsd } from '@shared/util/cost'
import { db } from '../db/client'
import {
  attachments,
  conversations,
  errorLogs,
  messages,
  models,
  providers,
  runs,
  usageLogs,
  users,
} from '../db/schema'
import { computeGenerationDurationMs } from './run-timing'

export interface StatsFilter {
  from?: number
  to?: number
  providerId?: string
  modelId?: string
  userId?: string
  success?: boolean
  scope?: 'upstream' | 'server' | 'stream' | 'frontend'
  search?: string
  bucket?: 'hour' | 'day'
  page?: number
  pageSize?: number
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function bucketMs(bucket: 'hour' | 'day'): number {
  return bucket === 'day' ? DAY_MS : HOUR_MS
}

/** SQLite 的 / 是浮点除法；用取模扣回桶起点，避免每条日志各自成桶。 */
function bucketStartExpr(size: number): SQL<number> {
  return sql<number>`${usageLogs.createdAt} - (${usageLogs.createdAt} % ${size})`
}

/** 据时间范围自动选择分桶粒度：超过 3 天用「天」，否则用「时」。 */
function autoBucket(filter: StatsFilter): 'hour' | 'day' {
  if (filter.bucket) return filter.bucket
  const span = (filter.to ?? Date.now()) - (filter.from ?? 0)
  return span > 3 * DAY_MS ? 'day' : 'hour'
}

/** usage_logs 的通用筛选条件。 */
function usageConds(filter: StatsFilter): SQL[] {
  const c: SQL[] = []
  if (filter.from != null) c.push(gte(usageLogs.createdAt, new Date(filter.from)))
  if (filter.to != null) c.push(lte(usageLogs.createdAt, new Date(filter.to)))
  if (filter.providerId) c.push(eq(usageLogs.providerId, filter.providerId))
  if (filter.modelId) c.push(eq(usageLogs.modelId, filter.modelId))
  if (filter.userId) c.push(eq(usageLogs.userId, filter.userId))
  if (filter.success !== undefined) c.push(eq(usageLogs.success, filter.success))
  return c
}

function whereOf(conds: SQL[]): SQL | undefined {
  return conds.length ? and(...conds) : undefined
}

async function getPricingMap(): Promise<Map<string, ModelPricing | null>> {
  const rows = await db.select({ id: models.id, pricing: models.pricing }).from(models)
  return new Map(rows.map((r) => [r.id, r.pricing ?? null]))
}

/** 把按 (modelId, tokens) 分组的行聚合成总成本（USD）。 */
function sumCost(
  rows: {
    modelId: string | null
    inputTokens: number
    cachedTokens: number
    outputTokens: number
    imageTokens: number
  }[],
  pricing: Map<string, ModelPricing | null>,
): number {
  let total = 0
  for (const r of rows) {
    total += costUsd(r, r.modelId ? (pricing.get(r.modelId) ?? null) : null)
  }
  return total
}

const TOKEN_SUMS = {
  inputTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens}),0)`,
  cachedTokens: sql<number>`coalesce(sum(${usageLogs.cachedTokens}),0)`,
  outputTokens: sql<number>`coalesce(sum(${usageLogs.outputTokens}),0)`,
  imageTokens: sql<number>`coalesce(sum(${usageLogs.imageTokens}),0)`,
}

// ============================ 概览 ============================

export async function getOverview(filter: StatsFilter): Promise<OverviewDTO> {
  const conds = usageConds(filter)
  const pricing = await getPricingMap()

  const [agg] = await db
    .select({
      requests: sql<number>`count(*)`,
      successes: sql<number>`coalesce(sum(${usageLogs.success}),0)`,
      input: sql<number>`coalesce(sum(${usageLogs.inputTokens}),0)`,
      cached: sql<number>`coalesce(sum(${usageLogs.cachedTokens}),0)`,
      tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
    })
    .from(usageLogs)
    .where(whereOf(conds))

  const byModel = await db
    .select({ modelId: usageLogs.modelId, ...TOKEN_SUMS })
    .from(usageLogs)
    .where(whereOf(conds))
    .groupBy(usageLogs.modelId)
  const cost = sumCost(byModel, pricing)

  // RPM/TPM：最近 60 分钟（仅叠加 provider/model/user 过滤，不受时间范围影响）
  const rateConds = usageConds({
    providerId: filter.providerId,
    modelId: filter.modelId,
    userId: filter.userId,
    from: Date.now() - HOUR_MS,
  })
  const [rate] = await db
    .select({
      requests: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
    })
    .from(usageLogs)
    .where(whereOf(rateConds))

  // 健康时间线
  const bucket = autoBucket(filter)
  const size = bucketMs(bucket)
  const bucketExpr = bucketStartExpr(size)
  const timeline = await db
    .select({
      ts: bucketExpr,
      requests: sql<number>`count(*)`,
      errors: sql<number>`coalesce(sum(case when ${usageLogs.success} then 0 else 1 end),0)`,
    })
    .from(usageLogs)
    .where(whereOf(conds))
    .groupBy(bucketExpr)
    .orderBy(asc(bucketExpr))

  const requests = agg?.requests ?? 0
  return {
    totals: {
      requests,
      successRate: requests ? (agg?.successes ?? 0) / requests : 1,
      tokens: agg?.tokens ?? 0,
      cacheRate: agg?.input ? (agg.cached ?? 0) / agg.input : 0,
      rpm: (rate?.requests ?? 0) / 60,
      tpm: (rate?.tokens ?? 0) / 60,
      costUsd: cost,
      users: await countRows(users),
      conversations: await countRows(conversations),
      messages: await countRows(messages),
      errors: await countRows(errorLogs),
    },
    healthTimeline: timeline.map((t) => ({ ts: t.ts, requests: t.requests, errors: t.errors })),
  }
}

async function countRows(
  table: typeof users | typeof conversations | typeof messages | typeof errorLogs,
): Promise<number> {
  const [r] = await db.select({ c: sql<number>`count(*)` }).from(table)
  return r?.c ?? 0
}

// ============================ 分析（时间序列）============================

export async function getAnalytics(filter: StatsFilter): Promise<AnalyticsDTO> {
  const bucket = autoBucket(filter)
  const size = bucketMs(bucket)
  const conds = usageConds(filter)
  const pricing = await getPricingMap()
  const bucketExpr = bucketStartExpr(size)

  const rows = await db
    .select({
      ts: bucketExpr,
      modelId: usageLogs.modelId,
      requests: sql<number>`count(*)`,
      inputTokens: TOKEN_SUMS.inputTokens,
      cachedTokens: TOKEN_SUMS.cachedTokens,
      outputTokens: TOKEN_SUMS.outputTokens,
      imageTokens: TOKEN_SUMS.imageTokens,
      reasoningTokens: sql<number>`coalesce(sum(${usageLogs.reasoningTokens}),0)`,
    })
    .from(usageLogs)
    .where(whereOf(conds))
    .groupBy(bucketExpr, usageLogs.modelId)
    .orderBy(asc(bucketExpr))

  const byTs = new Map<number, AnalyticsSeriesPoint>()
  for (const r of rows) {
    const point = byTs.get(r.ts) ?? {
      ts: r.ts,
      requests: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
    }
    point.requests += r.requests
    point.inputTokens += r.inputTokens
    point.cachedTokens += r.cachedTokens
    point.outputTokens += r.outputTokens
    point.reasoningTokens += r.reasoningTokens
    point.costUsd += costUsd(r, r.modelId ? (pricing.get(r.modelId) ?? null) : null)
    byTs.set(r.ts, point)
  }

  const series = [...byTs.values()].sort((a, b) => a.ts - b.ts)
  return { bucket, series }
}

// ============================ 分用户统计 ============================

export async function getUserStats(filter: StatsFilter): Promise<UserStatDTO[]> {
  const conds = usageConds(filter)
  const pricing = await getPricingMap()

  // 每用户基础聚合
  const base = await db
    .select({
      userId: usageLogs.userId,
      requests: sql<number>`count(*)`,
      successes: sql<number>`coalesce(sum(${usageLogs.success}),0)`,
      totalTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
      reasoningTokens: sql<number>`coalesce(sum(${usageLogs.reasoningTokens}),0)`,
      imageGenerations: sql<number>`coalesce(sum(case when ${usageLogs.imageTokens} > 0 then 1 else 0 end),0)`,
      lastUsageAt: sql<number | null>`max(${usageLogs.createdAt})`,
    })
    .from(usageLogs)
    .where(whereOf(conds))
    .groupBy(usageLogs.userId)

  // 每用户×模型 token（算成本 + 常用模型）
  const byUserModel = await db
    .select({
      userId: usageLogs.userId,
      modelId: usageLogs.modelId,
      modelLabel: usageLogs.modelLabel,
      calls: sql<number>`count(*)`,
      inputTokens: TOKEN_SUMS.inputTokens,
      cachedTokens: TOKEN_SUMS.cachedTokens,
      outputTokens: TOKEN_SUMS.outputTokens,
      imageTokens: TOKEN_SUMS.imageTokens,
    })
    .from(usageLogs)
    .where(whereOf(conds))
    .groupBy(usageLogs.userId, usageLogs.modelId, usageLogs.modelLabel)

  const costByUser = new Map<string, number>()
  const topModelsByUser = new Map<string, { model: string; calls: number }[]>()
  for (const r of byUserModel) {
    if (!r.userId) continue
    costByUser.set(
      r.userId,
      (costByUser.get(r.userId) ?? 0) + costUsd(r, r.modelId ? (pricing.get(r.modelId) ?? null) : null),
    )
    const list = topModelsByUser.get(r.userId) ?? []
    list.push({ model: r.modelLabel ?? '未知', calls: r.calls })
    topModelsByUser.set(r.userId, list)
  }

  const [convCounts, msgCounts, fileCounts, errCounts, userRows] = await Promise.all([
    db
      .select({ userId: conversations.userId, c: sql<number>`count(*)` })
      .from(conversations)
      .groupBy(conversations.userId),
    db
      .select({ userId: conversations.userId, c: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .groupBy(conversations.userId),
    db
      .select({ userId: attachments.userId, c: sql<number>`count(*)` })
      .from(attachments)
      .where(eq(attachments.kind, 'file'))
      .groupBy(attachments.userId),
    db
      .select({ userId: errorLogs.userId, c: sql<number>`count(*)` })
      .from(errorLogs)
      .groupBy(errorLogs.userId),
    db.select().from(users),
  ])

  const convMap = new Map(convCounts.map((r) => [r.userId, r.c]))
  const msgMap = new Map(msgCounts.map((r) => [r.userId, r.c]))
  const fileMap = new Map(fileCounts.map((r) => [r.userId ?? '', r.c]))
  const errMap = new Map(errCounts.map((r) => [r.userId ?? '', r.c]))
  const userMap = new Map(userRows.map((u) => [u.id, u]))

  const result: UserStatDTO[] = []
  for (const b of base) {
    if (!b.userId) continue
    const u = userMap.get(b.userId)
    if (!u) continue
    const topModels = (topModelsByUser.get(b.userId) ?? [])
      .sort((a, z) => z.calls - a.calls)
      .slice(0, 3)
    result.push({
      userId: b.userId,
      username: u.username,
      displayName: u.displayName,
      requests: b.requests,
      conversations: convMap.get(b.userId) ?? 0,
      messages: msgMap.get(b.userId) ?? 0,
      totalTokens: b.totalTokens,
      reasoningTokens: b.reasoningTokens,
      imageGenerations: b.imageGenerations,
      fileUploads: fileMap.get(b.userId) ?? 0,
      costUsd: costByUser.get(b.userId) ?? 0,
      errors: errMap.get(b.userId) ?? 0,
      successRate: b.requests ? b.successes / b.requests : 1,
      // 统计页的「最近活跃」应跟使用记录同源，避免把最近登录误显示成最近调用模型。
      lastActive: b.lastUsageAt,
      topModels,
    })
  }
  return result.sort((a, z) => z.requests - a.requests)
}

// ============================ 请求事件（分页）============================

export async function listUsageEvents(filter: StatsFilter): Promise<Paginated<UsageLogDTO>> {
  const conds = usageConds(filter)
  const page = filter.page ?? 1
  const pageSize = filter.pageSize ?? 50
  const pricing = await getPricingMap()

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(usageLogs)
    .where(whereOf(conds))

  const rows = await db
    .select({
      log: usageLogs,
      username: users.username,
      providerName: providers.name,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(usageLogs)
    .leftJoin(users, eq(usageLogs.userId, users.id))
    .leftJoin(providers, eq(usageLogs.providerId, providers.id))
    .leftJoin(runs, eq(usageLogs.runId, runs.id))
    .where(whereOf(conds))
    .orderBy(desc(usageLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const items: UsageLogDTO[] = rows.map(({ log, username, providerName, startedAt, finishedAt }) => ({
    id: log.id,
    userId: log.userId,
    username: username ?? null,
    providerId: log.providerId,
    providerLabel: providerName ?? log.providerLabel,
    modelLabel: log.modelLabel,
    inputTokens: log.inputTokens,
    cachedTokens: log.cachedTokens,
    outputTokens: log.outputTokens,
    reasoningTokens: log.reasoningTokens,
    totalTokens: log.totalTokens,
    imageTokens: log.imageTokens,
    success: log.success,
    errorType: log.errorType,
    costUsd: costUsd(log, log.modelId ? (pricing.get(log.modelId) ?? null) : null),
    durationMs: computeGenerationDurationMs(startedAt, finishedAt),
    createdAt: log.createdAt.getTime(),
  }))

  return { items, total, page, pageSize }
}

// ============================ 错误事件（分页）============================

export async function listErrorEvents(filter: StatsFilter): Promise<Paginated<ErrorLogDTO>> {
  const page = filter.page ?? 1
  const pageSize = filter.pageSize ?? 50
  const conds: SQL[] = []
  if (filter.from != null) conds.push(gte(errorLogs.createdAt, new Date(filter.from)))
  if (filter.to != null) conds.push(lte(errorLogs.createdAt, new Date(filter.to)))
  if (filter.userId) conds.push(eq(errorLogs.userId, filter.userId))
  if (filter.scope) conds.push(eq(errorLogs.scope, filter.scope))
  if (filter.search) conds.push(like(errorLogs.message, `%${filter.search}%`))

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(errorLogs)
    .where(whereOf(conds))

  const rows = await db
    .select({ log: errorLogs, username: users.username })
    .from(errorLogs)
    .leftJoin(users, eq(errorLogs.userId, users.id))
    .where(whereOf(conds))
    .orderBy(desc(errorLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const items: ErrorLogDTO[] = rows.map(({ log, username }) => ({
    id: log.id,
    scope: log.scope,
    errorType: log.errorType,
    code: log.code,
    httpStatus: log.httpStatus,
    message: log.message,
    detail: log.detail ?? null,
    userId: log.userId,
    username: username ?? null,
    runId: log.runId,
    createdAt: log.createdAt.getTime(),
  }))

  return { items, total, page, pageSize }
}
