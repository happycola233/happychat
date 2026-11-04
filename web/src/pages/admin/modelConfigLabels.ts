import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import { listAdminModelGroups, listAdminModels } from '../../api/admin'
import { describeModelRoutes } from './modelRoutes'

type LabeledModel = Pick<AdminModelDTO, 'id' | 'displayName' | 'modelId' | 'routes' | 'groupId'>

/** 固定短编号：取 UUID 随机尾段，列表排序或增删其他配置后编号不变。 */
export function modelConfigShortId(id: string): string {
  return `配置 ${id.slice(-8)}`
}

/**
 * 同名模型配置的区分说明（只为显示名重复的配置生成）。
 *
 * 从「分组 / 线路 / 模型 ID」里挑出同名配置之间确实不同的部分；
 * 挑完仍然相同的，再附上固定短编号。
 */
export function buildModelConfigHints(
  models: readonly LabeledModel[],
  groups: readonly Pick<AdminModelGroupDTO, 'id' | 'name'>[] = [],
): Map<string, string> {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  const byName = new Map<string, LabeledModel[]>()
  for (const model of models) {
    const name = model.displayName.trim()
    byName.set(name, [...(byName.get(name) ?? []), model])
  }
  const hints = new Map<string, string>()
  for (const cluster of byName.values()) {
    if (cluster.length < 2) continue
    const parts = cluster.map((model) => [
      model.groupId ? (groupNames.get(model.groupId) ?? '未知分组') : '未分组',
      describeModelRoutes(model),
      model.modelId,
    ])
    const varying = [0, 1, 2].filter((index) => new Set(parts.map((p) => p[index])).size > 1)
    const texts = parts.map((p) => varying.map((index) => p[index]).join(' · '))
    cluster.forEach((model, index) => {
      const text = texts[index]!
      const collides = texts.filter((other) => other === text).length > 1
      hints.set(
        model.id,
        [text, collides ? modelConfigShortId(model.id) : null].filter(Boolean).join(' · '),
      )
    })
  }
  return hints
}

/** 读取（已缓存的）模型与分组目录，返回同名配置的区分说明；非同名配置不在表中。 */
export function useModelConfigHints(): Map<string, string> {
  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: listAdminModelGroups,
  })
  return useMemo(() => buildModelConfigHints(models ?? [], groups ?? []), [models, groups])
}
