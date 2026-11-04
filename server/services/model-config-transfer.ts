import { sql } from 'drizzle-orm'
import {
  MODEL_CONFIG_FORMAT,
  MODEL_CONFIG_VERSION,
  modelConfigDocumentSchema,
  modelConfigEntrySchema,
  type ModelConfigEntry,
} from '@shared/schemas/model-config-transfer'
import {
  modelCreateSchema,
  modelUpdateSchema,
  type ModelRouteInput,
} from '@shared/schemas/model-config'
import type {
  AdminModelDTO,
  ModelConfigDocumentDTO,
  ConfigImportItemDTO,
  ConfigImportPreviewDTO,
} from '@shared/types/api'
import { db } from '../db/client'
import {
  emptyImportPreview,
  formatIssues,
  runImportTransaction,
  stableJson,
  summarizeImport,
} from '../lib/config-transfer'
import { modelGroups, providers } from '../db/schema'
import { must } from '../lib/assert'
import { inferModelDefaults } from '../provider/model-defaults'
import type { DbTransaction } from './model-icon-references'
import {
  MODEL_CONFIGURATION_ERROR_MESSAGES,
  createModelInTransaction,
  listAdminModels,
  updateModelInTransaction,
} from './models'

type ProviderRow = typeof providers.$inferSelect

/** 预览与导入共用的字段中文名；也决定差异列表的展示顺序。 */
const FIELD_LABELS = {
  modelId: '模型 ID',
  displayName: '显示名称',
  description: '描述',
  tags: '标签',
  icon: '图标',
  group: '分组',
  kind: '接口类型',
  enabled: '启用状态',
  capabilities: '能力',
  defaultSystemPrompt: '系统提示词',
  defaultParams: '默认参数',
  hardParams: '高级 JSON',
  allowedEfforts: '思考等级',
  defaultEffort: '默认思考等级',
  replayProviderContext: '私有上下文回传',
  defaultWebSearch: '默认联网搜索',
  defaultXSearch: '默认 X 搜索',
  usageNotice: '使用提示',
  pricing: '用户计价',
  routes: '线路',
} as const

type ComparableField = Exclude<keyof typeof FIELD_LABELS, 'group' | 'routes'>
const COMPARABLE_FIELDS = Object.keys(FIELD_LABELS).filter(
  (field): field is ComparableField => field !== 'group' && field !== 'routes',
)

/** 校验失败的条目仍尽量用文档里写的名称标识，而不是只给序号。 */
function rawEntryLabel(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { displayName, modelId } = raw as Record<string, unknown>
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim()
  return typeof modelId === 'string' && modelId.trim() ? modelId.trim() : null
}

/** 供应商名称唯一时导出名称（便于人和 AI 阅读），重名时退回 ID。 */
function providerReference(provider: ProviderRow, all: ProviderRow[]): string {
  return all.filter((item) => item.name === provider.name).length === 1
    ? provider.name
    : provider.id
}

function exportEntry(
  model: AdminModelDTO,
  groupName: string | null,
  providerRows: ProviderRow[],
): ModelConfigEntry {
  const providerById = new Map(providerRows.map((provider) => [provider.id, provider]))
  return {
    id: model.id,
    modelId: model.modelId,
    displayName: model.displayName,
    description: model.description,
    tags: model.tags,
    icon: model.icon,
    group: groupName,
    kind: model.kind,
    enabled: model.enabled,
    capabilities: model.capabilities,
    defaultSystemPrompt: model.defaultSystemPrompt,
    defaultParams: model.defaultParams,
    hardParams: model.hardParams,
    allowedEfforts: model.allowedEfforts,
    defaultEffort: model.defaultEffort,
    replayProviderContext: model.replayProviderContext,
    defaultWebSearch: model.defaultWebSearch,
    defaultXSearch: model.defaultXSearch,
    usageNotice: model.usageNotice ?? null,
    pricing: model.pricing,
    routes: model.routes.map((route) => ({
      id: route.id,
      provider: providerReference(must(providerById.get(route.providerId)), providerRows),
      upstreamModelId: route.upstreamModelId,
      priority: route.priority,
      weight: route.weight,
      enabled: route.enabled,
      costPricing: route.costPricing,
    })),
  }
}

/** 导出模型配置（不含 API Key 与用户名单）；ids 省略时导出全部模型。 */
export async function exportModelConfig(ids?: string[]): Promise<ModelConfigDocumentDTO> {
  const [allModels, providerRows, groupRows] = await Promise.all([
    listAdminModels(),
    db.select().from(providers).orderBy(providers.createdAt),
    db.select().from(modelGroups).orderBy(modelGroups.sort, modelGroups.name),
  ])
  const groupNames = new Map(groupRows.map((group) => [group.id, group.name]))
  const selected = ids ? allModels.filter((model) => ids.includes(model.id)) : allModels
  return {
    format: MODEL_CONFIG_FORMAT,
    version: MODEL_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    providers: providerRows.map((provider) => ({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
    })),
    groups: groupRows.map((group) => ({ id: group.id, name: group.name })),
    models: selected.map((model) =>
      exportEntry(
        model,
        model.groupId ? (groupNames.get(model.groupId) ?? null) : null,
        providerRows,
      ),
    ),
  }
}

interface ImportContext {
  tx: DbTransaction
  providers: ProviderRow[]
  groupsByName: Map<string, string[]>
  createdGroups: Map<string, string>
  existing: Map<string, AdminModelDTO>
}

function resolveProvider(ctx: ImportContext, reference: string): ProviderRow | string {
  const byId = ctx.providers.find((provider) => provider.id === reference)
  if (byId) return byId
  const byName = ctx.providers.filter((provider) => provider.name === reference)
  if (byName.length === 1) return byName[0]!
  return byName.length > 1
    ? `供应商名称「${reference}」不唯一，请改用供应商 ID`
    : `找不到供应商「${reference}」`
}

/** 解析分组名称；不存在的分组在本次导入中新建一次，多个模型引用同名分组时共用。 */
function resolveGroup(ctx: ImportContext, name: string): { id: string } | { error: string } {
  const ids = ctx.groupsByName.get(name) ?? []
  if (ids.length > 1) return { error: `分组名称「${name}」不唯一，请先在分组管理中改名` }
  if (ids[0]) return { id: ids[0] }
  let id = ctx.createdGroups.get(name)
  if (!id) {
    const maxSort = ctx.tx
      .select({ value: sql<number>`coalesce(max(${modelGroups.sort}), 0)` })
      .from(modelGroups)
      .get()!.value
    id = must(
      ctx.tx
        .insert(modelGroups)
        .values({ name, sort: maxSort + 100 })
        .returning({ id: modelGroups.id })
        .get(),
    ).id
    ctx.createdGroups.set(name, id)
  }
  return { id }
}

function routeContent(route: Omit<ModelRouteInput, 'id'>) {
  return {
    providerId: route.providerId,
    upstreamModelId: route.upstreamModelId ?? null,
    priority: route.priority,
    weight: route.weight,
    enabled: route.enabled,
    costPricing: route.costPricing ?? null,
  }
}

function importEntry(ctx: ImportContext, raw: unknown, index: number): ConfigImportItemDTO {
  const item: ConfigImportItemDTO = {
    index,
    action: 'error',
    id: null,
    label: `第 ${index + 1} 个模型`,
    changes: [],
    errors: [],
    notes: [],
  }
  const parsed = modelConfigEntrySchema.safeParse(raw)
  if (!parsed.success) {
    item.label = rawEntryLabel(raw) ?? item.label
    item.errors = formatIssues(parsed.error)
    return item
  }
  const { id, group, routes: routeEntries, ...fields } = parsed.data
  const existing = id ? ctx.existing.get(id) : undefined
  item.label = fields.displayName ?? existing?.displayName ?? fields.modelId ?? item.label
  if (id && !existing) item.notes.push('未找到该 ID 的模型，将作为新模型创建')

  let groupId: string | null | undefined
  if (group !== undefined) {
    if (group === null) groupId = null
    else {
      const resolved = resolveGroup(ctx, group)
      if ('error' in resolved) item.errors.push(resolved.error)
      else groupId = resolved.id
    }
  }

  let routes: ModelRouteInput[] | undefined
  let protocol: ProviderRow['protocol'] | undefined
  if (routeEntries) {
    routes = []
    routeEntries.forEach((route, routeIndex) => {
      const provider = resolveProvider(ctx, route.provider)
      if (typeof provider === 'string') {
        item.errors.push(`routes.${routeIndex}.provider：${provider}`)
        return
      }
      protocol ??= provider.protocol
      const { provider: _reference, ...rest } = route
      // 新建模型的线路不可能沿用其他模型的线路身份。
      routes!.push({
        ...rest,
        id: existing ? rest.id : undefined,
        providerId: provider.id,
        costPricing: rest.costPricing ?? null,
      })
    })
  }
  if (item.errors.length > 0) return item

  if (existing) {
    item.id = existing.id
    for (const field of COMPARABLE_FIELDS) {
      if (fields[field] !== undefined && stableJson(fields[field]) !== stableJson(existing[field]))
        item.changes.push(FIELD_LABELS[field])
    }
    if (groupId !== undefined && groupId !== existing.groupId) item.changes.push(FIELD_LABELS.group)
    const routesChanged =
      routes !== undefined &&
      stableJson(routes.map(routeContent)) !==
        stableJson(existing.routes.map((route) => routeContent(route)))
    if (routesChanged) item.changes.push(FIELD_LABELS.routes)
    if (item.changes.length === 0) {
      item.action = 'unchanged'
      return item
    }
    const input = modelUpdateSchema.safeParse({
      ...fields,
      ...(groupId !== undefined ? { groupId } : {}),
      ...(routesChanged ? { routes } : {}),
    })
    if (!input.success) {
      item.errors = formatIssues(input.error)
      return item
    }
    const result = updateModelInTransaction(ctx.tx, existing.id, input.data)
    if (!result.ok) {
      item.errors.push(
        result.code === 'model_missing'
          ? '模型已被删除'
          : MODEL_CONFIGURATION_ERROR_MESSAGES[result.code],
      )
      return item
    }
    item.action = 'update'
    return item
  }

  if (!fields.modelId) item.errors.push('新建模型必须填写 modelId')
  if (!routes) item.errors.push('新建模型必须填写 routes')
  if (item.errors.length > 0) return item
  const inferred = inferModelDefaults(fields.modelId!, protocol)
  const input = modelCreateSchema.safeParse({
    displayName: fields.modelId,
    ...inferred,
    ...fields,
    groupId: groupId ?? null,
    routes,
  })
  if (!input.success) {
    item.errors = formatIssues(input.error)
    return item
  }
  const result = createModelInTransaction(ctx.tx, input.data)
  if (!result.ok) {
    item.errors.push(MODEL_CONFIGURATION_ERROR_MESSAGES[result.code])
    return item
  }
  item.action = 'create'
  item.id = result.id
  item.changes = ['新建模型']
  return item
}

/**
 * 预览或应用一份模型配置文档。全部条目在同一个 IMMEDIATE 事务里按顺序执行：
 * 任一条出错则整份回滚；预览无论结果如何都回滚。
 */
export async function importModelConfig(
  document: unknown,
  mode: 'preview' | 'apply',
): Promise<ConfigImportPreviewDTO> {
  const parsedDocument = modelConfigDocumentSchema.safeParse(document)
  if (!parsedDocument.success) return emptyImportPreview(formatIssues(parsedDocument.error))
  const rawEntries = parsedDocument.data.models
  const referencedIds = rawEntries.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === 'string'
      ? [(entry as { id: string }).id]
      : [],
  )
  const adminModels = await listAdminModels()
  const existing = new Map(
    adminModels
      .filter((model) => referencedIds.includes(model.id))
      .map((model) => [model.id, model]),
  )
  return runImportTransaction((tx) => {
    const groupsByName = new Map<string, string[]>()
    for (const group of tx.select().from(modelGroups).all())
      groupsByName.set(group.name, [...(groupsByName.get(group.name) ?? []), group.id])
    const ctx: ImportContext = {
      tx,
      providers: tx.select().from(providers).all(),
      groupsByName,
      createdGroups: new Map(),
      existing,
    }
    // 同一份文档里两条记录指向同一模型会互相覆盖，直接拒绝。
    const duplicateIds = referencedIds.filter((id, index) => referencedIds.indexOf(id) !== index)
    const items = rawEntries.map((raw, index) => {
      const item = importEntry(ctx, raw, index)
      if (item.id && duplicateIds.includes(item.id) && item.action !== 'create') {
        item.errors.push('同一模型在文档中出现了多次')
        item.action = 'error'
      }
      return item
    })
    const createdGroups = [...ctx.createdGroups.keys()]
    return summarizeImport(
      items,
      createdGroups.length > 0 ? [`新建分组：${createdGroups.join('、')}`] : [],
      mode,
    )
  })
}
