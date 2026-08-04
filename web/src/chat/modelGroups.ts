import type { ModelDTO, ModelGroupDTO } from '@shared/types/api'

/**
 * 模型选择器的分区结构。`group=null` 是「未分组」伪分区，恒排在最后。
 * 与侧边栏的 `sidebarSections.ts` 同样是纯逻辑 + 单测，UI 只负责渲染。
 */
export interface ModelSection {
  /** null = 未分组 */
  group: ModelGroupDTO | null
  models: ModelDTO[]
}

export type ModelListView = 'flat' | 'tree'

export const UNGROUPED_LABEL = '未分组'

/** 分区的稳定 key（未分组用一个不可能与 uuid 冲突的常量）。 */
export function sectionKey(section: ModelSection): string {
  return section.group?.id ?? '__ungrouped__'
}

export function sectionName(section: ModelSection): string {
  return section.group?.name ?? UNGROUPED_LABEL
}

/**
 * 把模型按分组切成分区。
 *
 * - 分组顺序完全由服务端的 `sort` 决定（这里不再排序，避免与管理端拖拽结果不一致）；
 * - 组内保持 models 数组原有顺序（即模型自身的 sort），不做二次排序；
 * - **空分组直接丢弃**：用户点进去空空如也没有意义，服务端也已按可见性过滤过一轮，
 *   这里再兜一次是为了应对「分组可见但组内模型恰好都被筛掉」的情况；
 * - 引用了未知分组 id 的模型（分组刚被删、缓存还没刷新）归入未分组，绝不凭空丢模型。
 */
export function buildModelSections(models: ModelDTO[], groups: ModelGroupDTO[]): ModelSection[] {
  const byGroup = new Map<string, ModelDTO[]>()
  const ungrouped: ModelDTO[] = []
  const known = new Set(groups.map((group) => group.id))

  for (const model of models) {
    if (model.groupId && known.has(model.groupId)) {
      const bucket = byGroup.get(model.groupId)
      if (bucket) bucket.push(model)
      else byGroup.set(model.groupId, [model])
    } else {
      ungrouped.push(model)
    }
  }

  const sections: ModelSection[] = []
  for (const group of groups) {
    const members = byGroup.get(group.id)
    if (members?.length) sections.push({ group, models: members })
  }
  if (ungrouped.length) sections.push({ group: null, models: ungrouped })
  return sections
}

/** 是否存在真正的分组结构（只有未分组时，UI 退化为无标题平铺列表）。 */
export function hasGroupStructure(sections: ModelSection[]): boolean {
  return sections.some((section) => section.group !== null)
}

/**
 * 没有真实分组时彻底退化成普通平铺列表。
 * 账户中可能仍保留之前的 tree 偏好，但此时不能向用户暴露「未分组」伪目录。
 */
export function resolveModelListView(
  preferredView: ModelListView,
  sections: ModelSection[],
): ModelListView {
  return hasGroupStructure(sections) ? preferredView : 'flat'
}

function matches(model: ModelDTO, keyword: string): boolean {
  return (
    model.displayName.toLocaleLowerCase('zh-CN').includes(keyword) ||
    model.modelId.toLocaleLowerCase('zh-CN').includes(keyword)
  )
}

/**
 * 按关键词过滤分区：匹配模型名或上游 id，命中分组名时保留该组全部模型
 * （用户输入「Claude」时期望看到整个 Claude 分组，而不是只剩名字里带 Claude 的那几个）。
 * 过滤后为空的分区会被移除。
 */
export function filterModelSections(sections: ModelSection[], search: string): ModelSection[] {
  const keyword = search.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return sections
  const filtered: ModelSection[] = []
  for (const section of sections) {
    const groupHit = section.group?.name.toLocaleLowerCase('zh-CN').includes(keyword) ?? false
    const models = groupHit ? section.models : section.models.filter((m) => matches(m, keyword))
    if (models.length) filtered.push({ group: section.group, models })
  }
  return filtered
}

/** 展平分区（搜索态与无分组态共用一条渲染路径）。 */
export function flattenSections(sections: ModelSection[]): ModelDTO[] {
  return sections.flatMap((section) => section.models)
}

/** 找出某个模型所在的分区 key，用于二级目录视图打开时自动定位到当前选中项。 */
export function findSectionKeyOfModel(
  sections: ModelSection[],
  modelId: string | null,
): string | null {
  if (!modelId) return null
  for (const section of sections) {
    if (section.models.some((model) => model.id === modelId)) return sectionKey(section)
  }
  return null
}

/** 只在进入 tree 的边沿重新定位；tree 内主动钻取时保留用户当前目录。 */
export function openedSectionOnViewChange(
  previousView: ModelListView,
  nextView: ModelListView,
  currentOpenedKey: string | null,
  sections: ModelSection[],
  activeModelId: string | null,
): string | null {
  return previousView !== 'tree' && nextView === 'tree'
    ? findSectionKeyOfModel(sections, activeModelId)
    : currentOpenedKey
}

/**
 * 模型参数只应出现在用户已经能看到具体模型的层级。
 * 二级目录根层只负责选择分组；即使已有选中模型，也不在分组列表下方展示其参数，
 * 避免参数看起来像属于某个分组。搜索结果会直接展示模型，因此仍显示参数。
 */
export function shouldShowModelParameters(
  view: ModelListView,
  searching: boolean,
  openedSectionExists: boolean,
): boolean {
  return view !== 'tree' || searching || openedSectionExists
}
