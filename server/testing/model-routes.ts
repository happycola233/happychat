// 测试夹具：模型与供应商之间改由 model_routes 关联后，测试通过这里建立线路与单线路运行任务。
// 不静态导入 db/client：各测试在设置临时数据库环境变量后才动态加载数据库模块。
import type { DB } from '../db/client'
import type * as Schema from '../db/schema'
import type { RequestCostBreakdown } from '@shared/types/domain'
import type { RunExecution, RunRoute, RunTask } from '../runs/types'

type ModelRow = typeof Schema.models.$inferSelect
type ProviderRow = typeof Schema.providers.$inferSelect
type RouteValues = Partial<typeof Schema.modelRoutes.$inferInsert>

/** 为模型插入一条线路（默认沿用模型 ID、优先级 0、权重 1）。 */
export function insertModelRoute(
  db: DB,
  schema: typeof Schema,
  modelId: string,
  providerId: string,
  values: RouteValues = {},
) {
  return db
    .insert(schema.modelRoutes)
    .values({ modelId, providerId, sort: 100, ...values })
    .returning()
    .get()
}

/** 把线路行展开为运行时候选线路；成本价为 null 时结算沿用模型计价。 */
export function runRouteOf(
  route: typeof Schema.modelRoutes.$inferSelect,
  provider: ProviderRow,
  model: Pick<ModelRow, 'modelId'>,
): RunRoute {
  return {
    route,
    provider,
    upstreamModelId: route.upstreamModelId ?? model.modelId,
    costPricing: route.costPricing,
  }
}

/** 取得（必要时创建）模型在该供应商上的线路，并展开为运行时候选线路。 */
export function ensureRunRoute(
  db: DB,
  schema: typeof Schema,
  model: Pick<ModelRow, 'id' | 'modelId' | 'pricing'>,
  provider: ProviderRow,
): RunRoute {
  const route =
    db
      .select()
      .from(schema.modelRoutes)
      .all()
      .find((row) => row.modelId === model.id && row.providerId === provider.id) ??
    insertModelRoute(db, schema, model.id, provider.id)
  return runRouteOf(route, provider, model)
}

/** 没有任何上游用量时的成本明细。 */
export const ZERO_COST: RequestCostBreakdown = {
  chatUsd: 0,
  imageUsd: 0,
  totalUsd: 0,
  imageCount: 0,
  imageStatus: 'complete',
}

/** 旧式「模型 + 供应商 + 请求体」上下文 → 单线路运行任务；线路不存在时自动创建。 */
export function singleRouteTask<T extends Omit<RunTask, 'routing'>>(
  db: DB,
  schema: typeof Schema,
  context: T & { provider: ProviderRow; body: Record<string, unknown> },
): Omit<T, 'provider' | 'body'> & Pick<RunTask, 'routing'> {
  const { provider, body, ...task } = context
  return {
    ...task,
    routing: {
      candidates: [ensureRunRoute(db, schema, task.model, provider)],
      bodyFor: () => body,
    },
  }
}

export type { RunExecution }

type LegacyEngineContext = Omit<RunExecution, 'routing'> & {
  provider: ProviderRow
  body: Record<string, unknown>
}

/** 用旧式单供应商上下文驱动生成引擎（引擎入口现在接收线路计划）。 */
export function runOnSingleRoute(
  db: DB,
  schema: typeof Schema,
  engine: (execution: RunExecution) => Promise<void>,
  context: LegacyEngineContext,
): Promise<void> {
  return engine(singleRouteTask(db, schema, context) as RunExecution)
}

/** 首选线路的上游请求体（单线路模型即唯一线路）。 */
export function primaryBody(task: Pick<RunTask, 'routing'>): Record<string, unknown> {
  return task.routing.bodyFor(task.routing.candidates[0]!)
}
