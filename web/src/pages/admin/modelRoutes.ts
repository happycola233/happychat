import type { AdminModelDTO, ModelRouteDTO, ProviderDTO } from '@shared/types/api'
import type { ModelPricing, ProviderProtocol } from '@shared/types/domain'
import { modelRoutesSchema, type ModelRouteInput } from '@shared/schemas/model-config'

/** 编辑中的一条线路；draftId 只在表单内稳定标识行，保存时去掉。 */
export interface RouteDraft {
  draftId: string
  /** 已保存线路的 ID；新增线路为 undefined。 */
  id?: string
  providerId: string
  upstreamModelId: string
  priority: number
  weight: number
  enabled: boolean
  /** null=与用户计价相同。 */
  costPricing: ModelPricing | null
}

let draftSequence = 0
const nextDraftId = () => `route-draft-${++draftSequence}`

export function routeDraftFromDTO(route: ModelRouteDTO): RouteDraft {
  return {
    draftId: nextDraftId(),
    id: route.id,
    providerId: route.providerId,
    upstreamModelId: route.upstreamModelId ?? '',
    priority: route.priority,
    weight: route.weight,
    enabled: route.enabled,
    costPricing: route.costPricing,
  }
}

export function newRouteDraft(providerId: string, priority = 0): RouteDraft {
  return {
    draftId: nextDraftId(),
    providerId,
    upstreamModelId: '',
    priority,
    weight: 1,
    enabled: true,
    costPricing: null,
  }
}

/** 线路草稿 → 接口入参；校验与服务端共用同一份 schema。 */
export function routeDraftsToInput(
  drafts: RouteDraft[],
): { ok: true; routes: ModelRouteInput[] } | { ok: false; message: string } {
  const parsed = modelRoutesSchema.safeParse(
    drafts.map(({ draftId: _draftId, upstreamModelId, ...route }) => ({
      ...route,
      upstreamModelId: upstreamModelId.trim() || null,
    })),
  )
  if (parsed.success) return { ok: true, routes: parsed.data }
  const issue = parsed.error.issues[0]
  const row = typeof issue?.path[0] === 'number' ? `线路 ${issue.path[0] + 1}：` : ''
  return { ok: false, message: `${row}${issue?.message ?? '请检查线路设置'}` }
}

/** 线路的协议必须一致；返回首条线路决定的协议，混用时额外报告冲突。 */
export function routesProtocol(
  drafts: Pick<RouteDraft, 'providerId'>[],
  providers: Pick<ProviderDTO, 'id' | 'protocol'>[],
): { protocol: ProviderProtocol | undefined; mixed: boolean } {
  const protocols = drafts
    .map((draft) => providers.find((provider) => provider.id === draft.providerId)?.protocol)
    .filter((protocol): protocol is ProviderProtocol => Boolean(protocol))
  return { protocol: protocols[0], mixed: new Set(protocols).size > 1 }
}

export interface RouteTierItem {
  key: string
  label: string
  /** 同一优先级内按权重得到的流量占比（0–1）。 */
  share: number
  enabled: boolean
}

export interface RouteTier {
  priority: number
  items: RouteTierItem[]
}

/**
 * 调度顺序预览：只统计可调度（线路与供应商都启用）的线路，按优先级从高到低分档，
 * 档内按权重换算占比。停用线路不参与调度，单独列在末尾。
 */
export function routeTiers(
  routes: {
    key: string
    label: string
    priority: number
    weight: number
    enabled: boolean
  }[],
): { tiers: RouteTier[]; disabled: RouteTierItem[] } {
  const enabled = routes.filter((route) => route.enabled)
  const priorities = [...new Set(enabled.map((route) => route.priority))].sort((a, b) => b - a)
  const tiers = priorities.map((priority) => {
    const members = enabled.filter((route) => route.priority === priority)
    const totalWeight = members.reduce((sum, route) => sum + Math.max(1, route.weight), 0)
    return {
      priority,
      items: members.map((route) => ({
        key: route.key,
        label: route.label,
        share: Math.max(1, route.weight) / totalWeight,
        enabled: true,
      })),
    }
  })
  return {
    tiers,
    disabled: routes
      .filter((route) => !route.enabled)
      .map((route) => ({ key: route.key, label: route.label, share: 0, enabled: false })),
  }
}

/** 可调度的线路：线路启用且供应商启用。 */
export function runnableRoutes(model: Pick<AdminModelDTO, 'routes'>): ModelRouteDTO[] {
  return model.routes.filter((route) => route.enabled && route.providerEnabled)
}

/** 列表、搜索结果里的一行供应商摘要：首选线路的供应商，多条时附带总数。 */
export function describeModelRoutes(model: Pick<AdminModelDTO, 'routes'>): string {
  const runnable = runnableRoutes(model)
  if (model.routes.length === 0) return '未配置线路'
  if (runnable.length === 0) return '线路均已停用'
  const primary = [...runnable].sort((a, b) => b.priority - a.priority)[0]!
  return runnable.length > 1
    ? `${primary.providerName} 等 ${runnable.length} 条线路`
    : primary.providerName
}

/** 模型经过的全部供应商（含停用线路），用于按供应商筛选。 */
export function modelProviderIds(model: Pick<AdminModelDTO, 'routes'>): string[] {
  return [...new Set(model.routes.map((route) => route.providerId))]
}
