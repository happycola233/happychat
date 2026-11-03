import type { ModelPricing } from '@shared/types/domain'
import type { conversations, messages, models, providers, runs } from '../db/schema'
import type { RouteTarget } from '../services/model-routes'

export type RunRow = typeof runs.$inferSelect
export type ModelRow = typeof models.$inferSelect
export type ProviderRow = typeof providers.$inferSelect
export type ConvRow = typeof conversations.$inferSelect
export type MsgRow = typeof messages.$inferSelect

export type ImageOperation = 'generate' | 'edit'

/** 调度后的一条候选线路，附带请求开始时冻结的上游成本价。 */
export interface RunRoute extends RouteTarget {
  /** null=与用户计价相同，结算时直接使用冻结的用户计价快照。 */
  costPricing: ModelPricing | null
}

/** 本次生成的线路计划：按调度顺序排列的候选线路，以及按线路构建上游请求体的工厂。 */
export interface RunRoutePlan {
  candidates: RunRoute[]
  bodyFor: (route: RunRoute) => Record<string, unknown>
}

/** 交给 RunManager 的生成任务；每次尝试由 executeRun 选定线路后展开为 EngineContext。 */
export interface RunTask {
  run: RunRow
  assistantMessage: MsgRow
  conversation: ConvRow
  /** 用户可见的模型配置；pricing 为请求开始时冻结的用户计价快照。 */
  model: ModelRow
  routing: RunRoutePlan
  imageOperation?: ImageOperation
}

export interface RunExecution extends RunTask {
  abortController: AbortController
}

/**
 * 单次上游尝试的上下文。协议引擎只读取这里的 provider / body / model：
 * model.modelId 已替换为当前线路实际发送的上游模型 ID，私有上下文按它与供应商来源门控。
 */
export interface EngineContext extends RunExecution {
  route: RunRoute
  provider: ProviderRow
  body: Record<string, unknown>
}
