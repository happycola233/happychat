import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import type {
  AdminModelDTO,
  ModelAccessDTO,
  ModelDTO,
  ModelRouteDTO,
  ProviderDTO,
  ProviderDetailDTO,
} from '@shared/types/api'
import {
  MODEL_DISPLAY_NAME_MAX_LENGTH,
  type ModelAccessUpdateInput,
  type ModelCreateInput,
  type ModelRouteInput,
  type ModelUpdateInput,
} from '@shared/schemas/model-config'
import type { ModelKind } from '@shared/types/domain'
import {
  hasAnthropicMaxOutputTokens,
  hasAnthropicThinkingBudgetConflict,
} from '@shared/util/anthropic'
import { normalizeModelCapabilitiesForKind } from '@shared/util/modelCapabilities'
import { normalizeModelIcon } from '@shared/util/modelIcon'
import { normalizeModelTags } from '@shared/util/modelTags'
import { normalizeReasoningEffortOptions } from '@shared/util/reasoning'
import { providerProtocolSupportsModelKind } from '@shared/util/providerProtocol'
import { normalizeSearchParamsForModelKind } from '@shared/util/searchTools'
import { db } from '../db/client'
import { modelRoutes, models, modelGroups, modelUserAccess, providers, users } from '../db/schema'
import { must } from '../lib/assert'
import { maskSecret } from '../lib/mask'
import { modelIconReferencesExist, type DbTransaction } from './model-icon-references'
import { validImagePricingSource } from './model-pricing'
import {
  hasRunnableRoute,
  listModelRouteDTOs,
  listRunnableRouteTargets,
  type RouteTarget,
} from './model-routes'

type ModelRow = typeof models.$inferSelect
type ProviderRow = typeof providers.$inferSelect
const MODEL_ACCESS_INSERT_BATCH_SIZE = 250

export function toModelDTO(m: ModelRow): ModelDTO {
  const capabilities = normalizeModelCapabilitiesForKind(m.kind, m.capabilities)
  const isChatCompletions = m.kind === 'chat'
  return {
    id: m.id,
    modelId: m.modelId,
    displayName: m.displayName,
    kind: m.kind,
    // 老记录可能缺少后加入的能力位，出参前统一补齐。
    capabilities,
    description: m.description ?? null,
    usageNotice: m.usageNotice ?? null,
    // 旧记录的 string[] 与新对象数组在 API 边界统一升级，非法颜色安全回退为自动配色。
    tags: normalizeModelTags(m.tags),
    // 图标要拼进 URL 与 CSS mask，出参前统一归一化，非法值降级为 null（前端回退自动识别）。
    icon: normalizeModelIcon(m.icon),
    groupId: m.groupId ?? null,
    // API 只公开规范对象；旧 string[] 记录在这里无损升级，保留原顺序和子集。
    allowedEfforts: normalizeReasoningEffortOptions(m.allowedEfforts),
    defaultEffort: m.defaultEffort ?? null,
    defaultWebSearch: isChatCompletions ? false : m.defaultWebSearch,
    defaultXSearch: isChatCompletions ? false : m.defaultXSearch,
    defaultParams: normalizeSearchParamsForModelKind(m.kind, m.defaultParams) ?? null,
  }
}

export function toAdminModelDTO(
  m: ModelRow,
  routes: ModelRouteDTO[],
  allowedUserCount = 0,
): AdminModelDTO {
  return {
    ...toModelDTO(m),
    routes,
    enabled: m.enabled,
    accessMode: m.accessMode,
    // all 模式下关联行不参与语义；即使遇到历史脏数据，也不向前端报告误导性人数。
    allowedUserCount: m.accessMode === 'selected' ? allowedUserCount : 0,
    defaultSystemPrompt: m.defaultSystemPrompt,
    replayProviderContext: m.replayProviderContext,
    hardParams: m.hardParams ?? null,
    pricing: m.pricing ?? null,
    sort: m.sort,
  }
}

interface ProviderModelCounts {
  modelCount: number
  exclusiveModelCount: number
}

const NO_PROVIDER_MODELS: ProviderModelCounts = { modelCount: 0, exclusiveModelCount: 0 }

export function toProviderDTO(p: ProviderRow, counts: ProviderModelCounts): ProviderDTO {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    protocol: p.protocol,
    enabled: p.enabled,
    hasApiKey: Boolean(p.apiKey),
    apiKeyMask: p.apiKey ? maskSecret(p.apiKey) : null,
    extraHeaderCount: Object.keys(p.extraHeaders).length,
    modelCount: counts.modelCount,
    exclusiveModelCount: counts.exclusiveModelCount,
    createdAt: p.createdAt.getTime(),
  }
}

export function toProviderDetailDTO(
  p: ProviderRow,
  counts: ProviderModelCounts,
): ProviderDetailDTO {
  return {
    ...toProviderDTO(p, counts),
    apiKey: p.apiKey,
    extraHeaders: p.extraHeaders,
  }
}

/** 每个供应商承接的模型数，以及「只靠它」的模型数（删除供应商前的影响提示）。 */
async function providerModelCounts(): Promise<Map<string, ProviderModelCounts>> {
  const rows = await db
    .select({ modelId: modelRoutes.modelId, providerId: modelRoutes.providerId })
    .from(modelRoutes)
  const providersByModel = new Map<string, Set<string>>()
  for (const row of rows) {
    const providerIds = providersByModel.get(row.modelId) ?? new Set<string>()
    providerIds.add(row.providerId)
    providersByModel.set(row.modelId, providerIds)
  }
  const counts = new Map<string, ProviderModelCounts>()
  for (const providerIds of providersByModel.values()) {
    for (const providerId of providerIds) {
      const current = counts.get(providerId) ?? { ...NO_PROVIDER_MODELS }
      current.modelCount += 1
      if (providerIds.size === 1) current.exclusiveModelCount += 1
      counts.set(providerId, current)
    }
  }
  return counts
}

export async function listProviders(): Promise<ProviderDTO[]> {
  const provs = await db.select().from(providers).orderBy(providers.createdAt)
  const counts = await providerModelCounts()
  return provs.map((p) => toProviderDTO(p, counts.get(p.id) ?? NO_PROVIDER_MODELS))
}

export async function getProviderDetail(id: string): Promise<ProviderDetailDTO | null> {
  const [p] = await db.select().from(providers).where(eq(providers.id, id)).limit(1)
  if (!p) return null
  const counts = await providerModelCounts()
  return toProviderDetailDTO(p, counts.get(id) ?? NO_PROVIDER_MODELS)
}

/**
 * 用户级可用性的关联与谓词。管理员没有隐式绕过：控制面能配置全部模型，
 * 但用户端模型列表和生成请求都服从同一条件。
 *
 * 导出供 `services/model-groups.ts` 复用——分组的可见性必须与模型列表**逐字一致**，
 * 各写一份迟早会漂移，进而让用户看到点进去是空的分组。
 */
export const accessJoinForUser = (userId: string) =>
  and(eq(modelUserAccess.modelId, models.id), eq(modelUserAccess.userId, userId))

export const accessibleToUser = () =>
  or(eq(models.accessMode, 'all'), isNotNull(modelUserAccess.userId))

/** 模型全局启用且至少有一条可调度线路；用户端所有可见性判断共用。 */
export const modelIsRunnable = () => and(eq(models.enabled, true), hasRunnableRoute(models.id))

export async function listEnabledModels(userId: string): Promise<ModelDTO[]> {
  const rows = await db
    .select({ model: models })
    .from(models)
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(and(modelIsRunnable(), accessibleToUser()))
    .orderBy(models.sort, models.displayName)
  return rows.map((r) => toModelDTO(r.model))
}

/** 可发起生成的模型与它的可调度线路（按展示顺序；调度排序在发起请求时进行）。 */
export interface RunnableModel {
  model: ModelRow
  routes: RouteTarget[]
}

async function withRunnableRoutes(model: ModelRow | undefined): Promise<RunnableModel | null> {
  if (!model) return null
  const routes = await listRunnableRouteTargets(model.id, model.modelId)
  return routes.length > 0 ? { model, routes } : null
}

/** 取当前用户可用于生成的模型及其可调度线路。 */
export async function getRunnableModel(id: string, userId: string): Promise<RunnableModel | null> {
  const [row] = await db
    .select({ model: models })
    .from(models)
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(and(eq(models.id, id), modelIsRunnable(), accessibleToUser()))
    .limit(1)
  return withRunnableRoutes(row?.model)
}

/** 标题总结回退用：取当前用户可用的首个文本模型，避免后台任务绕过用户白名单。 */
export async function getFirstRunnableTextModel(userId: string): Promise<RunnableModel | null> {
  const [row] = await db
    .select({ model: models })
    .from(models)
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(and(modelIsRunnable(), ne(models.kind, 'image'), accessibleToUser()))
    .orderBy(models.sort, models.displayName)
    .limit(1)
  return withRunnableRoutes(row?.model)
}

async function allowedUserCounts(modelIds?: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ modelId: modelUserAccess.modelId, count: sql<number>`count(*)` })
    .from(modelUserAccess)
    .where(modelIds ? inArray(modelUserAccess.modelId, modelIds) : undefined)
    .groupBy(modelUserAccess.modelId)
  return new Map(rows.map((row) => [row.modelId, Number(row.count)]))
}

export async function listAdminModels(): Promise<AdminModelDTO[]> {
  const rows = await db.select().from(models).orderBy(models.sort, models.displayName)
  const [accessCountByModel, routesByModel] = await Promise.all([
    allowedUserCounts(),
    listModelRouteDTOs(),
  ])
  return rows.map((row) =>
    toAdminModelDTO(row, routesByModel.get(row.id) ?? [], accessCountByModel.get(row.id) ?? 0),
  )
}

export async function getAdminModel(id: string): Promise<AdminModelDTO | null> {
  const [row] = await db.select().from(models).where(eq(models.id, id)).limit(1)
  if (!row) return null
  const [accessCountByModel, routesByModel] = await Promise.all([
    allowedUserCounts([id]),
    listModelRouteDTOs([id]),
  ])
  return toAdminModelDTO(row, routesByModel.get(id) ?? [], accessCountByModel.get(id) ?? 0)
}

/** 读取一个模型的完整用户访问名单；仅供管理员配置面板使用。 */
export async function getModelAccess(id: string): Promise<ModelAccessDTO | null> {
  const [model] = await db
    .select({ accessMode: models.accessMode })
    .from(models)
    .where(eq(models.id, id))
    .limit(1)
  if (!model) return null
  if (model.accessMode === 'all') return { accessMode: 'all', userIds: [] }

  const rows = await db
    .select({ userId: modelUserAccess.userId })
    .from(modelUserAccess)
    .where(eq(modelUserAccess.modelId, id))
    .orderBy(modelUserAccess.userId)
  return { accessMode: 'selected', userIds: rows.map((row) => row.userId) }
}

export type UpdateModelAccessResult =
  | { ok: true; access: ModelAccessDTO }
  | { ok: false; code: 'model_missing' }
  | { ok: false; code: 'unknown_users'; unknownUserIds: string[] }

/**
 * 原子替换模型的完整用户访问范围。selected 模式先在同一事务内确认名单用户都存在，
 * 再一次性更新 access_mode 和关联行；任何未知用户都会让整次修改无副作用地失败。
 */
export async function updateModelAccess(
  id: string,
  input: ModelAccessUpdateInput,
): Promise<UpdateModelAccessResult> {
  return db.transaction(
    (tx): UpdateModelAccessResult => {
      const model = tx.select({ id: models.id }).from(models).where(eq(models.id, id)).get()
      if (!model) return { ok: false, code: 'model_missing' }

      // all 必须先规范为空名单，避免客户端残留选择影响“对所有用户开放”的保存操作。
      // schema 已拒绝重复项；这里仍去重，保证服务函数被内部直接调用时也不会触发主键冲突。
      const storedUserIds = input.accessMode === 'selected' ? [...new Set(input.userIds)] : []
      // 不对最多 10000 个 ID 生成单条 IN (...)，避免撞到不同 SQLite 构建的参数上限。
      const existingUserIdSet = new Set(
        storedUserIds.length > 0
          ? tx
              .select({ id: users.id })
              .from(users)
              .all()
              .map((user) => user.id)
          : [],
      )
      const unknownUserIds = storedUserIds.filter((userId) => !existingUserIdSet.has(userId))
      if (unknownUserIds.length > 0) {
        return { ok: false, code: 'unknown_users', unknownUserIds }
      }

      tx.update(models)
        .set({ accessMode: input.accessMode, updatedAt: new Date() })
        .where(eq(models.id, id))
        .run()
      tx.delete(modelUserAccess).where(eq(modelUserAccess.modelId, id)).run()
      for (
        let offset = 0;
        offset < storedUserIds.length;
        offset += MODEL_ACCESS_INSERT_BATCH_SIZE
      ) {
        const batch = storedUserIds.slice(offset, offset + MODEL_ACCESS_INSERT_BATCH_SIZE)
        tx.insert(modelUserAccess)
          .values(batch.map((userId) => ({ modelId: id, userId })))
          .run()
      }

      return {
        ok: true,
        access: { accessMode: input.accessMode, userIds: storedUserIds },
      }
    },
    { behavior: 'immediate' },
  )
}

export type CreateModelResult =
  | { ok: true; model: AdminModelDTO }
  | {
      ok: false
      code: ModelConfigurationErrorCode
    }

export type ModelConfigurationErrorCode =
  | 'provider_missing'
  | 'provider_protocol_mismatch'
  | 'route_missing'
  | 'route_duplicate'
  | 'group_missing'
  | 'icon_missing'
  | 'anthropic_max_output_tokens_required'
  | 'anthropic_thinking_budget_conflict'
  | 'invalid_default_effort'
  | 'invalid_image_pricing_source'

/** 模型配置校验失败的用户可读说明；管理接口与配置导入共用。 */
export const MODEL_CONFIGURATION_ERROR_MESSAGES: Record<ModelConfigurationErrorCode, string> = {
  invalid_image_pricing_source: '请选择纯生图模型作为生图定价来源',
  provider_missing: '线路使用的供应商不存在，请刷新后重试',
  provider_protocol_mismatch: '模型类型与线路供应商的协议不匹配',
  route_missing: '线路已被删除或不属于该模型，请刷新后重试',
  route_duplicate: '同一供应商下不能有两条发往相同上游模型 ID 的线路',
  group_missing: '所选分组不存在，请刷新后重试',
  icon_missing: '所选图标不存在，请刷新后重试',
  anthropic_max_output_tokens_required: 'Anthropic Messages API 必须配置正整数 max_output_tokens',
  anthropic_thinking_budget_conflict: 'Anthropic thinking.budget_tokens 必须小于最终 max_tokens',
  invalid_default_effort: '默认思考等级必须包含在可用等级中',
}

function includesReasoningEffort(
  allowedEfforts: Parameters<typeof normalizeReasoningEffortOptions>[0],
  defaultEffort: string | null | undefined,
): boolean {
  if (!defaultEffort) return true
  return normalizeReasoningEffortOptions(allowedEfforts).some(
    (option) => option.value === defaultEffort,
  )
}

/** 线路写入前的形态：已去掉客户端 id 以外的派生字段。 */
type RouteDraft = Pick<
  ModelRouteInput,
  'id' | 'providerId' | 'upstreamModelId' | 'priority' | 'weight' | 'enabled' | 'costPricing'
>

/**
 * 校验一组线路能否承接该模型：供应商存在、协议与模型类型兼容、同一供应商下不出现
 * 两条发往同一上游模型 ID 的重复线路，且更新时引用的线路 id 确实属于该模型。
 */
function validateRoutes(
  tx: DbTransaction,
  kind: ModelKind,
  canonicalModelId: string,
  routes: Pick<RouteDraft, 'id' | 'providerId' | 'upstreamModelId'>[],
  modelId: string | null,
): ModelConfigurationErrorCode | null {
  const providerIds = [...new Set(routes.map((route) => route.providerId))]
  const providerRows = tx
    .select({ id: providers.id, protocol: providers.protocol })
    .from(providers)
    .where(inArray(providers.id, providerIds))
    .all()
  if (providerRows.length !== providerIds.length) return 'provider_missing'
  if (providerRows.some((provider) => !providerProtocolSupportsModelKind(provider.protocol, kind)))
    return 'provider_protocol_mismatch'
  const targets = routes.map((route) =>
    JSON.stringify([route.providerId, route.upstreamModelId ?? canonicalModelId]),
  )
  if (new Set(targets).size !== targets.length) return 'route_duplicate'
  const routeIds = routes.flatMap((route) => (route.id ? [route.id] : []))
  if (routeIds.length > 0) {
    const owned = modelId
      ? tx
          .select({ id: modelRoutes.id })
          .from(modelRoutes)
          .where(and(eq(modelRoutes.modelId, modelId), inArray(modelRoutes.id, routeIds)))
          .all()
      : []
    if (owned.length !== routeIds.length) return 'route_missing'
  }
  return null
}

/**
 * 原子替换模型的线路集合：保留提交中带 id 的线路身份（请求审计按线路统计），
 * 删除未提交的旧线路，新增无 id 的线路；数组顺序写入 sort。
 */
function replaceModelRoutes(tx: DbTransaction, modelId: string, routes: RouteDraft[]): void {
  const keptIds = routes.flatMap((route) => (route.id ? [route.id] : []))
  const existing = tx
    .select({ id: modelRoutes.id })
    .from(modelRoutes)
    .where(eq(modelRoutes.modelId, modelId))
    .all()
  const removedIds = existing.map((route) => route.id).filter((id) => !keptIds.includes(id))
  if (removedIds.length > 0) tx.delete(modelRoutes).where(inArray(modelRoutes.id, removedIds)).run()
  routes.forEach((route, index) => {
    const values = {
      providerId: route.providerId,
      upstreamModelId: route.upstreamModelId ?? null,
      priority: route.priority,
      weight: route.weight,
      enabled: route.enabled,
      costPricing: route.costPricing ?? null,
      sort: (index + 1) * 100,
    }
    if (route.id) tx.update(modelRoutes).set(values).where(eq(modelRoutes.id, route.id)).run()
    else
      tx.insert(modelRoutes)
        .values({ ...values, modelId })
        .run()
  })
}

type CreateModelInTransactionResult =
  | { ok: true; id: string }
  | { ok: false; code: ModelConfigurationErrorCode }

/**
 * 在调用方事务内校验并写入一个新模型及其线路；手动添加与配置导入共用。
 * 同一模型 ID 允许多条配置（参数不同视为不同的模型实例）。
 */
export function createModelInTransaction(
  tx: DbTransaction,
  input: ModelCreateInput,
): CreateModelInTransactionResult {
  if (!includesReasoningEffort(input.allowedEfforts, input.defaultEffort)) {
    return { ok: false, code: 'invalid_default_effort' } as const
  }
  const routeError = validateRoutes(tx, input.kind, input.modelId, input.routes, null)
  if (routeError) return { ok: false, code: routeError } as const
  if (!validImagePricingSource(input.pricing, input.kind)) {
    return { ok: false, code: 'invalid_image_pricing_source' } as const
  }
  if (input.kind === 'anthropic' && !hasAnthropicMaxOutputTokens(input.defaultParams)) {
    return { ok: false, code: 'anthropic_max_output_tokens_required' } as const
  }
  if (
    input.kind === 'anthropic' &&
    hasAnthropicThinkingBudgetConflict(
      input.hardParams?.max_tokens ?? input.defaultParams?.max_output_tokens,
      input.hardParams?.thinking,
    )
  ) {
    return { ok: false, code: 'anthropic_thinking_budget_conflict' } as const
  }
  // 分组存在性显式校验：FK 违例会抛成 500，这里换成可读的 400。
  if (input.groupId) {
    const group = tx
      .select({ id: modelGroups.id })
      .from(modelGroups)
      .where(eq(modelGroups.id, input.groupId))
      .limit(1)
      .get()
    if (!group) return { ok: false, code: 'group_missing' } as const
  }
  if (!modelIconReferencesExist(tx, [input.icon])) {
    return { ok: false, code: 'icon_missing' } as const
  }

  const capabilities = normalizeModelCapabilitiesForKind(input.kind, input.capabilities)
  const isChatCompletions = input.kind === 'chat'
  const defaultParams =
    normalizeSearchParamsForModelKind(input.kind, input.defaultParams ?? null) ?? null
  const row = must(
    tx
      .insert(models)
      .values({
        modelId: input.modelId,
        displayName: input.displayName,
        description: input.description ?? null,
        usageNotice: input.usageNotice ?? null,
        tags: input.tags,
        icon: input.icon ?? null,
        groupId: input.groupId ?? null,
        kind: input.kind,
        enabled: input.enabled,
        capabilities,
        defaultSystemPrompt: input.defaultSystemPrompt ?? null,
        defaultParams,
        hardParams: input.hardParams ?? null,
        pricing: input.pricing ?? null,
        allowedEfforts: input.allowedEfforts,
        defaultEffort: input.defaultEffort ?? null,
        replayProviderContext: input.replayProviderContext,
        defaultWebSearch: isChatCompletions ? false : input.defaultWebSearch,
        defaultXSearch: isChatCompletions ? false : input.defaultXSearch,
        sort: input.sort,
      })
      .returning()
      .get(),
  )
  replaceModelRoutes(tx, row.id, input.routes)
  return { ok: true, id: row.id } as const
}

export async function createModel(input: ModelCreateInput): Promise<CreateModelResult> {
  const result = db.transaction((tx) => createModelInTransaction(tx, input), {
    behavior: 'immediate',
  })
  if (!result.ok) return result
  return { ok: true, model: must(await getAdminModel(result.id)) }
}

export type DuplicateModelResult =
  | { ok: true; model: AdminModelDTO }
  | { ok: false; code: 'model_missing' }

/**
 * 创建一份独立的模型配置副本。模型的内部 id 、时间戳与后续修改彼此独立；
 * 线路与指定用户模式下的白名单也在同一事务中复制，避免新模型短暂落入错误的开放范围。
 */
export async function duplicateModel(id: string): Promise<DuplicateModelResult> {
  const result = db.transaction(
    (tx) => {
      const source = tx.select().from(models).where(eq(models.id, id)).limit(1).get()
      if (!source) return { ok: false, code: 'model_missing' } as const

      const sourceAccessRows =
        source.accessMode === 'selected'
          ? tx
              .select({ userId: modelUserAccess.userId })
              .from(modelUserAccess)
              .where(eq(modelUserAccess.modelId, id))
              .all()
          : []
      const sourceRoutes = tx
        .select()
        .from(modelRoutes)
        .where(eq(modelRoutes.modelId, id))
        .orderBy(modelRoutes.sort)
        .all()
      const nameSuffix = ' 副本'
      const copiedDisplayName = `${source.displayName.slice(
        0,
        MODEL_DISPLAY_NAME_MAX_LENGTH - nameSuffix.length,
      )}${nameSuffix}`
      const capabilities = normalizeModelCapabilitiesForKind(source.kind, source.capabilities)
      const isChatCompletions = source.kind === 'chat'
      const copied = must(
        tx
          .insert(models)
          .values({
            modelId: source.modelId,
            displayName: copiedDisplayName,
            description: source.description,
            usageNotice: source.usageNotice,
            tags: normalizeModelTags(source.tags),
            icon: normalizeModelIcon(source.icon),
            groupId: source.groupId,
            kind: source.kind,
            enabled: source.enabled,
            accessMode: source.accessMode,
            capabilities,
            defaultSystemPrompt: source.defaultSystemPrompt,
            defaultParams:
              normalizeSearchParamsForModelKind(source.kind, source.defaultParams) ?? null,
            hardParams: source.hardParams,
            pricing: source.pricing,
            allowedEfforts: normalizeReasoningEffortOptions(source.allowedEfforts),
            defaultEffort: source.defaultEffort,
            replayProviderContext: source.replayProviderContext,
            defaultWebSearch: isChatCompletions ? false : source.defaultWebSearch,
            defaultXSearch: isChatCompletions ? false : source.defaultXSearch,
            // 保留 sort 使副本紧邻源模型；下次拖拽会重写为唯一的稀疏排序值。
            sort: source.sort,
          })
          .returning()
          .get(),
      )
      replaceModelRoutes(
        tx,
        copied.id,
        sourceRoutes.map(({ id: _sourceRouteId, ...route }) => route),
      )

      for (
        let offset = 0;
        offset < sourceAccessRows.length;
        offset += MODEL_ACCESS_INSERT_BATCH_SIZE
      ) {
        const batch = sourceAccessRows.slice(offset, offset + MODEL_ACCESS_INSERT_BATCH_SIZE)
        tx.insert(modelUserAccess)
          .values(batch.map(({ userId }) => ({ modelId: copied.id, userId })))
          .run()
      }

      return { ok: true, id: copied.id } as const
    },
    { behavior: 'immediate' },
  )
  if (!result.ok) return result
  return { ok: true, model: must(await getAdminModel(result.id)) }
}

export type UpdateModelResult =
  | { ok: true }
  | { ok: false; code: 'model_missing' | ModelConfigurationErrorCode }

/** 在调用方事务内更新模型配置；线路替换与模型类型/协议校验同时完成。 */
export function updateModelInTransaction(
  tx: DbTransaction,
  id: string,
  input: ModelUpdateInput,
): UpdateModelResult {
  const existing = tx.select().from(models).where(eq(models.id, id)).limit(1).get()
  if (!existing) return { ok: false, code: 'model_missing' }

  const nextKind = input.kind ?? existing.kind
  const nextModelId = input.modelId ?? existing.modelId
  // 只改类型或模型 ID 时也要复核现有线路，避免与供应商协议分裂或出现重复线路。
  const nextRoutes =
    input.routes ??
    tx
      .select({
        id: modelRoutes.id,
        providerId: modelRoutes.providerId,
        upstreamModelId: modelRoutes.upstreamModelId,
      })
      .from(modelRoutes)
      .where(eq(modelRoutes.modelId, id))
      .all()
  if (nextRoutes.length > 0) {
    const routeError = validateRoutes(tx, nextKind, nextModelId, nextRoutes, id)
    if (routeError) return { ok: false, code: routeError }
  }
  if (
    !validImagePricingSource(
      input.pricing === undefined ? existing.pricing : input.pricing,
      nextKind,
    )
  ) {
    return { ok: false, code: 'invalid_image_pricing_source' }
  }

  const nextCapabilities = normalizeModelCapabilitiesForKind(
    nextKind,
    input.capabilities ?? existing.capabilities,
  )
  const nextDefaultParams =
    normalizeSearchParamsForModelKind(
      nextKind,
      input.defaultParams !== undefined ? input.defaultParams : existing.defaultParams,
    ) ?? null
  const nextHardParams = input.hardParams !== undefined ? input.hardParams : existing.hardParams
  if (nextKind === 'anthropic' && !hasAnthropicMaxOutputTokens(nextDefaultParams)) {
    return { ok: false, code: 'anthropic_max_output_tokens_required' }
  }
  if (
    nextKind === 'anthropic' &&
    hasAnthropicThinkingBudgetConflict(
      nextHardParams?.max_tokens ?? nextDefaultParams?.max_output_tokens,
      nextHardParams?.thinking,
    )
  ) {
    return { ok: false, code: 'anthropic_thinking_budget_conflict' }
  }

  let nextReasoningConfig:
    | Pick<typeof models.$inferInsert, 'allowedEfforts' | 'defaultEffort'>
    | undefined
  if (input.allowedEfforts !== undefined || input.defaultEffort !== undefined) {
    const nextAllowedEfforts = input.allowedEfforts ?? existing.allowedEfforts
    const nextDefaultEffort =
      input.defaultEffort !== undefined ? input.defaultEffort : existing.defaultEffort
    if (!includesReasoningEffort(nextAllowedEfforts, nextDefaultEffort)) {
      return { ok: false, code: 'invalid_default_effort' }
    }
    nextReasoningConfig = {
      allowedEfforts: nextAllowedEfforts,
      defaultEffort: nextDefaultEffort,
    }
  }

  if (input.groupId) {
    const group = tx
      .select({ id: modelGroups.id })
      .from(modelGroups)
      .where(eq(modelGroups.id, input.groupId))
      .limit(1)
      .get()
    if (!group) return { ok: false, code: 'group_missing' }
  }
  if (input.icon !== undefined && !modelIconReferencesExist(tx, [input.icon])) {
    return { ok: false, code: 'icon_missing' }
  }

  const patch: Partial<typeof models.$inferInsert> = {}
  // 同 id 多实例：修改 modelId 不再检查是否重复。
  if (input.modelId !== undefined) patch.modelId = input.modelId
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.description !== undefined) patch.description = input.description
  if (input.usageNotice !== undefined) patch.usageNotice = input.usageNotice
  if (input.tags !== undefined) patch.tags = input.tags
  if (input.icon !== undefined) patch.icon = input.icon
  if (input.groupId !== undefined) patch.groupId = input.groupId
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.kind !== undefined) patch.kind = input.kind
  if (input.capabilities !== undefined || nextKind === 'chat') {
    patch.capabilities = nextCapabilities
  }
  if (input.defaultSystemPrompt !== undefined) {
    patch.defaultSystemPrompt = input.defaultSystemPrompt
  }
  if (input.defaultParams !== undefined || input.hardParams !== undefined || nextKind === 'chat') {
    patch.defaultParams = nextDefaultParams
    patch.hardParams = nextHardParams
  }
  if (input.pricing !== undefined) patch.pricing = input.pricing
  if (nextReasoningConfig) {
    patch.allowedEfforts = nextReasoningConfig.allowedEfforts
    patch.defaultEffort = nextReasoningConfig.defaultEffort
  }
  if (input.replayProviderContext !== undefined) {
    patch.replayProviderContext = input.replayProviderContext
  }
  if (nextKind === 'chat') {
    patch.defaultWebSearch = false
    patch.defaultXSearch = false
  } else {
    if (input.defaultWebSearch !== undefined) patch.defaultWebSearch = input.defaultWebSearch
    if (input.defaultXSearch !== undefined) patch.defaultXSearch = input.defaultXSearch
  }
  if (input.sort !== undefined) patch.sort = input.sort
  // 只改线路时也刷新 updatedAt，让列表与配置导出能看出该模型被调整过。
  if (Object.keys(patch).length > 0 || input.routes) {
    tx.update(models)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(models.id, id))
      .run()
  }
  if (input.routes) replaceModelRoutes(tx, id, input.routes)
  return { ok: true }
}

/** 原子更新模型配置。 */
export async function updateModel(id: string, input: ModelUpdateInput): Promise<UpdateModelResult> {
  return db.transaction((tx) => updateModelInTransaction(tx, id, input), {
    behavior: 'immediate',
  })
}

export type ReorderModelsResult =
  | { ok: true }
  | { ok: false; code: 'invalid_order'; invalidIds: string[] }

/**
 * 按管理员提交的完整列表重写模型顺序。
 * sort 使用稀疏步长，后续单个模型插队时仍有空间，不必立刻整体重排。
 */
export async function reorderModels(modelIds: string[]): Promise<ReorderModelsResult> {
  const existing = await db.select({ id: models.id }).from(models)
  const existingIds = new Set(existing.map((m) => m.id))
  const submittedIds = new Set(modelIds)
  const unknownIds = modelIds.filter((id) => !existingIds.has(id))
  const omittedIds = existing.map((m) => m.id).filter((id) => !submittedIds.has(id))
  if (unknownIds.length || omittedIds.length) {
    return { ok: false, code: 'invalid_order', invalidIds: [...unknownIds, ...omittedIds] }
  }

  db.transaction((tx) => {
    for (const [index, id] of modelIds.entries()) {
      tx.update(models)
        .set({ sort: (index + 1) * 100 })
        .where(eq(models.id, id))
        .run()
    }
  })

  return { ok: true }
}
