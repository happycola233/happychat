import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { ActiveRequestDTO, ActiveRequestsDTO } from '@shared/types/api'
import type { RetryAuditSummary } from '@shared/types/retry'
import { requestedReasoningEffort } from '@shared/util/reasoning'
import { db } from '../db/client'
import { errorLogs, models, providers, runs, users } from '../db/schema'
import type { StatsFilter } from './stats'

/** 活跃状态独立于用量账本，不能提前插入零 Token 的 usage_log 改变统计与额度。 */
export function listActiveRequests(filter: StatsFilter): ActiveRequestsDTO {
  const observedAt = Date.now()
  const pageSize = filter.pageSize ?? 50
  if (filter.kind === 'title' || filter.result || filter.success !== undefined)
    return { items: [], total: 0, page: 1, pageSize, observedAt }

  const conditions: SQL[] = [inArray(runs.state, ['queued', 'running'])]
  if (filter.from != null) conditions.push(gte(runs.createdAt, new Date(filter.from)))
  if (filter.to != null) conditions.push(lte(runs.createdAt, new Date(filter.to)))
  if (filter.userId) conditions.push(eq(runs.userId, filter.userId))
  if (filter.modelId) conditions.push(eq(runs.modelId, filter.modelId))
  if (filter.providerId)
    conditions.push(
      sql`coalesce(json_extract(${runs.progress}, '$.providerId'), ${models.providerId}) = ${filter.providerId}`,
    )
  const where = and(...conditions)
  const { total } = db
    .select({ total: sql<number>`count(*)` })
    .from(runs)
    .leftJoin(models, eq(runs.modelId, models.id))
    .where(where)
    .get()!
  const page = Math.min(filter.page ?? 1, Math.max(1, Math.ceil(total / pageSize)))
  const rows = db
    .select({
      runId: runs.id,
      userId: runs.userId,
      username: users.username,
      modelLabel: models.modelId,
      modelDisplayName: models.displayName,
      providerLabel: providers.name,
      requestParams: runs.requestParams,
      createdAt: runs.createdAt,
      startedAt: runs.startedAt,
      progress: runs.progress,
    })
    .from(runs)
    .leftJoin(users, eq(runs.userId, users.id))
    .leftJoin(models, eq(runs.modelId, models.id))
    .leftJoin(providers, eq(models.providerId, providers.id))
    .where(where)
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
  const audits = rows.length
    ? db
        .select({ runId: errorLogs.runId, detail: errorLogs.detail })
        .from(errorLogs)
        .where(
          and(
            inArray(
              errorLogs.runId,
              rows.map((row) => row.runId),
            ),
            eq(errorLogs.scope, 'upstream'),
          ),
        )
        .all()
    : []
  const retryByRun = new Map(
    audits.map((audit) => [audit.runId, audit.detail?.retry as RetryAuditSummary | undefined]),
  )
  const items: ActiveRequestDTO[] = rows.map(({ requestParams, ...row }) => {
    const retry = retryByRun.get(row.runId)
    return {
      ...row,
      modelLabel: row.progress?.modelLabel ?? row.modelLabel,
      modelDisplayName: row.progress?.modelDisplayName ?? row.modelDisplayName,
      providerLabel: row.progress?.providerLabel ?? row.providerLabel,
      reasoningEffort: requestedReasoningEffort(requestParams),
      createdAt: row.createdAt.getTime(),
      startedAt: row.startedAt?.getTime() ?? null,
      // 诊断原文只在错误日志中提供，频繁刷新的监控列表仅返回简短、已脱敏的原因。
      retrySummary: retry
        ? {
            ...retry,
            failures: retry.failures.map((failure) => ({ ...failure, rawMessage: undefined })),
          }
        : null,
    }
  })
  return { items, total, page, pageSize, observedAt }
}
