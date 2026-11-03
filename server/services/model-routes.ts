import { and, asc, eq, gte, inArray, sql, type AnyColumn } from 'drizzle-orm'
import type { ModelRouteDTO, ModelRouteHealthDTO } from '@shared/types/api'
import type { RunErrorIdentity } from '@shared/types/domain'
import { classifyRunError } from '@shared/util/runError'
import { db } from '../db/client'
import { modelRoutes, providers, usageLogs } from '../db/schema'

export type ModelRouteRow = typeof modelRoutes.$inferSelect
type ProviderRow = typeof providers.$inferSelect

/** 一条可以发起请求的线路：线路配置 + 供应商连接 + 实际发送的上游模型 ID。 */
export interface RouteTarget {
  route: ModelRouteRow
  provider: ProviderRow
  upstreamModelId: string
}

/**
 * 「模型存在至少一条可调度线路」的 SQL 谓词：线路启用且其供应商启用。
 * 用户端模型列表、分组可见性、额度目标与生成准入必须共用这一条件。
 */
export const hasRunnableRoute = (modelIdColumn: AnyColumn) => sql`exists (
  select 1 from ${modelRoutes}
  inner join ${providers} on ${providers.id} = ${modelRoutes.providerId}
  where ${modelRoutes.modelId} = ${modelIdColumn}
    and ${modelRoutes.enabled} = 1
    and ${providers.enabled} = 1
)`

export function toRouteTarget(
  route: ModelRouteRow,
  provider: ProviderRow,
  canonicalModelId: string,
): RouteTarget {
  return { route, provider, upstreamModelId: route.upstreamModelId ?? canonicalModelId }
}

/** 读取模型的可调度线路（线路与供应商均启用），按展示顺序返回，尚未做调度排序。 */
export async function listRunnableRouteTargets(
  modelId: string,
  canonicalModelId: string,
): Promise<RouteTarget[]> {
  const rows = await db
    .select({ route: modelRoutes, provider: providers })
    .from(modelRoutes)
    .innerJoin(providers, eq(modelRoutes.providerId, providers.id))
    .where(
      and(
        eq(modelRoutes.modelId, modelId),
        eq(modelRoutes.enabled, true),
        eq(providers.enabled, true),
      ),
    )
    .orderBy(asc(modelRoutes.sort))
  return rows.map((row) => toRouteTarget(row.route, row.provider, canonicalModelId))
}

export function toModelRouteDTO(route: ModelRouteRow, provider: ProviderRow): ModelRouteDTO {
  return {
    id: route.id,
    providerId: provider.id,
    providerName: provider.name,
    providerProtocol: provider.protocol,
    providerEnabled: provider.enabled,
    upstreamModelId: route.upstreamModelId,
    priority: route.priority,
    weight: route.weight,
    enabled: route.enabled,
    costPricing: route.costPricing ?? null,
  }
}

/** 批量读取多个模型的全部线路（含停用），按模型分组并保持展示顺序。 */
export async function listModelRouteDTOs(
  modelIds?: string[],
): Promise<Map<string, ModelRouteDTO[]>> {
  if (modelIds && modelIds.length === 0) return new Map()
  const rows = await db
    .select({ route: modelRoutes, provider: providers })
    .from(modelRoutes)
    .innerJoin(providers, eq(modelRoutes.providerId, providers.id))
    .where(modelIds ? inArray(modelRoutes.modelId, modelIds) : undefined)
    .orderBy(asc(modelRoutes.sort), asc(modelRoutes.createdAt))
  const byModel = new Map<string, ModelRouteDTO[]>()
  for (const row of rows) {
    const list = byModel.get(row.route.modelId) ?? []
    list.push(toModelRouteDTO(row.route, row.provider))
    byModel.set(row.route.modelId, list)
  }
  return byModel
}

// ---------------------------------------------------------------------------
// 熔断：连续线路级失败达到阈值后冷却一段时间，期间排到候选末尾（仍可作为最后手段）。
// 状态只在进程内维护：单进程部署下足够，重启后从健康状态重新观察。
// ---------------------------------------------------------------------------

export const ROUTE_BREAKER_THRESHOLD = 3
const ROUTE_COOLDOWN_BASE_MS = 30_000
const ROUTE_COOLDOWN_MAX_MS = 10 * 60_000

interface RouteHealthState {
  consecutiveFailures: number
  cooldownUntil: number
  lastFailureAt: number | null
  lastFailureMessage: string | null
  lastSuccessAt: number | null
}

export class RouteHealthRegistry {
  private states = new Map<string, RouteHealthState>()

  private state(routeId: string): RouteHealthState {
    let current = this.states.get(routeId)
    if (!current) {
      current = {
        consecutiveFailures: 0,
        cooldownUntil: 0,
        lastFailureAt: null,
        lastFailureMessage: null,
        lastSuccessAt: null,
      }
      this.states.set(routeId, current)
    }
    return current
  }

  recordSuccess(routeId: string, now = Date.now()): void {
    const current = this.state(routeId)
    current.consecutiveFailures = 0
    current.cooldownUntil = 0
    current.lastSuccessAt = now
  }

  /** 只记录线路级故障；参数、内容审核等请求本身的问题换任何线路都一样，不影响健康度。 */
  recordFailure(routeId: string, message: string, now = Date.now()): void {
    const current = this.state(routeId)
    current.consecutiveFailures += 1
    current.lastFailureAt = now
    current.lastFailureMessage = message
    if (current.consecutiveFailures >= ROUTE_BREAKER_THRESHOLD) {
      const exponent = current.consecutiveFailures - ROUTE_BREAKER_THRESHOLD
      current.cooldownUntil =
        now + Math.min(ROUTE_COOLDOWN_BASE_MS * 2 ** exponent, ROUTE_COOLDOWN_MAX_MS)
    }
  }

  isCooling(routeId: string, now = Date.now()): boolean {
    return (this.states.get(routeId)?.cooldownUntil ?? 0) > now
  }

  snapshot(routeId: string, now = Date.now()) {
    const current = this.states.get(routeId)
    const cooling = (current?.cooldownUntil ?? 0) > now
    return {
      state: cooling
        ? ('cooling' as const)
        : current?.consecutiveFailures
          ? ('degraded' as const)
          : ('healthy' as const),
      consecutiveFailures: current?.consecutiveFailures ?? 0,
      cooldownUntil: cooling ? current!.cooldownUntil : null,
      lastFailureAt: current?.lastFailureAt ?? null,
      lastFailureMessage: current?.lastFailureMessage ?? null,
      lastSuccessAt: current?.lastSuccessAt ?? null,
    }
  }

  reset(): void {
    this.states.clear()
  }
}

export const routeHealth = new RouteHealthRegistry()

/**
 * 调度顺序：优先级从高到低分档；同档内按权重做无放回加权随机（Efraimidis–Spirakis），
 * 实现按权重分流；熔断冷却中的线路整体移到末尾，保证所有线路都冷却时请求仍可尝试。
 */
export function orderRouteCandidates(
  targets: RouteTarget[],
  options: { now?: number; random?: () => number; health?: RouteHealthRegistry } = {},
): RouteTarget[] {
  const now = options.now ?? Date.now()
  const random = options.random ?? Math.random
  const health = options.health ?? routeHealth
  const keyed = targets.map((target) => ({
    target,
    cooling: health.isCooling(target.route.id, now),
    // random ∈ [0,1)；1-random 落在 (0,1]，避免 0 的 1/weight 次方让权重失效。
    key: (1 - random()) ** (1 / Math.max(1, target.route.weight)),
  }))
  keyed.sort(
    (a, b) =>
      Number(a.cooling) - Number(b.cooling) ||
      b.target.route.priority - a.target.route.priority ||
      b.key - a.key,
  )
  return keyed.map((item) => item.target)
}

/**
 * 失败是否归咎于线路（换一条线路可能成功）。鉴权、余额、限流、模型不存在、网络与
 * 服务端故障属于线路；上下文过大、附件无效、内容拦截与参数错误属于请求本身。
 */
export function isRouteFault(identity: RunErrorIdentity): boolean {
  const kind = classifyRunError(identity)
  return ![
    'context_too_large',
    'attachment_rejected',
    'content_blocked',
    'invalid_request',
  ].includes(kind)
}

const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000

/** 合并进程内熔断状态与近 24 小时用量日志指标。 */
export async function getRouteHealth(routeIds: string[]): Promise<ModelRouteHealthDTO[]> {
  if (routeIds.length === 0) return []
  const since = new Date(Date.now() - HEALTH_WINDOW_MS)
  const rows = await db
    .select({
      routeId: usageLogs.routeId,
      requests: sql<number>`count(*)`,
      failures: sql<number>`sum(case when ${usageLogs.outcome} = 'failed' then 1 else 0 end)`,
      avgLatencyMs: sql<
        number | null
      >`avg(case when ${usageLogs.outcome} <> 'failed' then ${usageLogs.upstreamResponseLatencyMs} end)`,
    })
    .from(usageLogs)
    .where(and(inArray(usageLogs.routeId, routeIds), gte(usageLogs.createdAt, since)))
    .groupBy(usageLogs.routeId)
  const statsByRoute = new Map(rows.map((row) => [row.routeId, row]))
  return routeIds.map((routeId) => {
    const stats = statsByRoute.get(routeId)
    return {
      routeId,
      ...routeHealth.snapshot(routeId),
      recentRequests: Number(stats?.requests ?? 0),
      recentFailures: Number(stats?.failures ?? 0),
      recentAvgLatencyMs:
        stats?.avgLatencyMs == null ? null : Math.round(Number(stats.avgLatencyMs)),
    }
  })
}
